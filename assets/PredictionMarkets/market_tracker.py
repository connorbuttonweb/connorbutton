import requests
import pandas as pd
import yfinance as yf
import os
import time
from datetime import datetime, timedelta, timezone

# --- Configuration ---
GAMMA_API_URL = "https://gamma-api.polymarket.com/markets"
CLOB_API_URL = "https://clob.polymarket.com/prices-history"
SPX_TICKER = "^GSPC"
EXCEL_FILE_PATH = "assets/PredictionMarkets/Prediction_Market_Master.xlsx"

def get_todays_slug():
    """
    Generates the slug for the S&P 500 market that JUST closed (or is active).
    Since this runs at 4:30 PM ET, we want the market dated for today.
    """
    # Get current time in ET (approximate via UTC offset)
    now_utc = datetime.now(timezone.utc)
    now_et = now_utc - timedelta(hours=5) 
    
    # If weekend, this market doesn't exist.
    if now_et.weekday() >= 5:
        print("Today is a weekend. No S&P 500 market.")
        return None

    month = now_et.strftime("%B").lower()
    day = now_et.day
    year = now_et.year
    
    return f"spx-up-or-down-on-{month}-{day}-{year}"

def get_clob_token_id(slug):
    """
    Step 1 & 2: Get Markets Endpoint -> Get CLOB Token ID.
    """
    print(f"Fetching Market Metadata for: {slug}")
    try:
        # 1. Query the Markets Endpoint
        response = requests.get(f"{GAMMA_API_URL}?slug={slug}")
        response.raise_for_status()
        data = response.json()
        
        if not data:
            print(f"No market found for slug: {slug}")
            return None

        # Handle list vs dict response
        market = data[0] if isinstance(data, list) else data
        
        # 2. Extract CLOB Token ID
        # "clobTokenIds" is usually ["No_ID", "Yes_ID"]
        clob_ids = market.get("clobTokenIds", [])
        outcomes = market.get("outcomes", [])
        
        # Find the index for "Yes"
        if "Yes" in outcomes:
            yes_index = outcomes.index("Yes")
            token_id = clob_ids[yes_index]
            print(f"Found 'Yes' Token ID: {token_id}")
            return token_id
        else:
            print("Could not find 'Yes' outcome.")
            return None
            
    except Exception as e:
        print(f"Error getting Token ID: {e}")
        return None

def get_polymarket_timeseries(token_id, start_ts, end_ts):
    """
    Step 3: Put Token ID into Time Series Endpoint.
    """
    print("Fetching Polymarket CLOB Time Series...")
    params = {
        "market": token_id,
        "interval": "1m",
        "startTs": int(start_ts),
        "endTs": int(end_ts)
    }
    
    try:
        response = requests.get(CLOB_API_URL, params=params)
        response.raise_for_status()
        data = response.json()
        
        history = data.get("history", [])
        if not history:
            print("No history data returned from CLOB.")
            return pd.DataFrame()
            
        df = pd.DataFrame(history)
        # Rename for clarity: 't' is timestamp, 'p' is price
        df = df.rename(columns={'t': 'Timestamp', 'p': 'Poly_Probability'})
        
        # Convert unix timestamp to datetime (UTC)
        df['Timestamp'] = pd.to_datetime(df['Timestamp'], unit='s', utc=True)
        return df[['Timestamp', 'Poly_Probability']]
        
    except Exception as e:
        print(f"Error fetching time series: {e}")
        return pd.DataFrame()

def get_spx_timeseries():
    """
    Fetches intraday S&P 500 data (1-minute intervals) for today.
    """
    print("Fetching S&P 500 Intraday Data...")
    try:
        # Fetch 1 day of 1-minute data
        df = yf.download(SPX_TICKER, period="1d", interval="1m", progress=False)
        
        if df.empty:
            print("No S&P 500 data found.")
            return pd.DataFrame()

        # Reset index to make Datetime a column
        df = df.reset_index()
        
        # Standardize Timezone to UTC
        if df['Datetime'].dt.tz is None:
            df['Datetime'] = df['Datetime'].dt.tz_localize('UTC')
        else:
            df['Datetime'] = df['Datetime'].dt.tz_convert('UTC')
            
        # Clean up
        df = df.rename(columns={'Datetime': 'Timestamp', 'Close': 'SPX_Price', 'Volume': 'SPX_Volume'})
        return df[['Timestamp', 'SPX_Price', 'SPX_Volume']]
        
    except Exception as e:
        print(f"Error fetching SPX data: {e}")
        return pd.DataFrame()

def save_merged_data(df):
    """Saves the merged dataset to Excel."""
    os.makedirs(os.path.dirname(EXCEL_FILE_PATH), exist_ok=True)
    
    try:
        if os.path.exists(EXCEL_FILE_PATH):
            existing_df = pd.read_excel(EXCEL_FILE_PATH)
            # Append new data
            final_df = pd.concat([existing_df, df], ignore_index=True)
        else:
            final_df = df
            
        with pd.ExcelWriter(EXCEL_FILE_PATH, engine='openpyxl') as writer:
            final_df.to_excel(writer, index=False)
        print(f"Successfully saved {len(df)} rows to {EXCEL_FILE_PATH}")
        
    except Exception as e:
        print(f"Error saving to Excel: {e}")

def main():
    slug = get_todays_slug()
    if not slug:
        return

    # 1. Get CLOB Token ID (The "Key")
    token_id = get_clob_token_id(slug)
    if not token_id:
        return

    # 2. Get S&P Data first (to define the exact time window)
    spx_df = get_spx_timeseries()
    if spx_df.empty:
        return
        
    # Define window based on actual trading hours we captured
    start_ts = spx_df['Timestamp'].min().timestamp()
    end_ts = spx_df['Timestamp'].max().timestamp()

    # 3. Get Polymarket Time Series using the Token ID
    poly_df = get_polymarket_timeseries(token_id, start_ts, end_ts)
    if poly_df.empty:
        return

    # 4. Merge Data (Align timestamps)
    # sort to ensure merge_asof works
    spx_df = spx_df.sort_values('Timestamp')
    poly_df = poly_df.sort_values('Timestamp')

    # Merge with 60s tolerance to align the minute candles
    merged_df = pd.merge_asof(
        spx_df, 
        poly_df, 
        on='Timestamp', 
        direction='nearest', 
        tolerance=pd.Timedelta("60s")
    )

    # 5. Clean and Save
    merged_df['Date'] = datetime.now().strftime("%Y-%m-%d")
    merged_df = merged_df.dropna(subset=['Poly_Probability']) # Remove unmatched rows
    
    save_merged_data(merged_df)

if __name__ == "__main__":
    main()