import asyncio
import pandas as pd
import yfinance as yf
import os
import requests
from datetime import datetime, timedelta, timezone
from py_clob_client.client import ClobClient

# --- Configuration ---
SPX_TICKER = "^GSPC"
EXCEL_FILE_PATH = "assets/PredictionMarkets/Prediction_Market_Master.xlsx"
CLOB_HOST = "https://clob.polymarket.com"
CHAIN_ID = 137 # Polygon Mainnet

def get_todays_slug():
    """Generates the slug for the S&P 500 market that JUST closed."""
    # Convert UTC to ET (approximate)
    now_utc = datetime.now(timezone.utc)
    now_et = now_utc - timedelta(hours=5) 
    
    print(f"DEBUG: Current ET Time: {now_et} (Weekday: {now_et.weekday()})")

    # Weekday check: 0=Mon, 4=Fri, 5=Sat, 6=Sun
    if now_et.weekday() >= 5:
        print("DEBUG: Status -> Weekend detected. No S&P 500 market. Exiting.")
        return None

    month = now_et.strftime("%B").lower()
    day = now_et.day
    year = now_et.year
    
    slug = f"spx-up-or-down-on-{month}-{day}-{year}"
    print(f"DEBUG: Generated Target Slug: {slug}")
    return slug

def get_token_id_from_slug(slug):
    """
    CRITICAL STEP: We use Gamma to find the 'Token ID' (Asset ID).
    """
    gamma_url = f"https://gamma-api.polymarket.com/markets?slug={slug}"
    try:
        print(f"DEBUG: Querying Gamma API for {slug}...")
        resp = requests.get(gamma_url)
        resp.raise_for_status()
        data = resp.json()
        
        if not data:
            print(f"DEBUG: ERROR -> Slug not found in Gamma API: {slug}")
            return None
            
        market = data[0] if isinstance(data, list) else data
        
        # Gamma returns 'clobTokenIds' which matches outcomes ["No", "Yes"]
        clob_ids = market.get("clobTokenIds", [])
        outcomes = market.get("outcomes", [])
        
        if "Yes" in outcomes:
            yes_index = outcomes.index("Yes")
            token_id = clob_ids[yes_index]
            print(f"DEBUG: Verified Token ID for 'Yes': {token_id}")
            return token_id
        else:
            print(f"DEBUG: ERROR -> 'Yes' outcome not found in market data. Outcomes: {outcomes}")
            return None
            
    except Exception as e:
        print(f"DEBUG: Gamma Lookup Exception: {e}")
        return None

async def fetch_clob_history(token_id, start_ts, end_ts):
    """
    Uses the official py-clob-client to fetch history.
    """
    if ClobClient is None: return pd.DataFrame()
    
    print(f"DEBUG: Fetching CLOB history for Token {token_id}...")
    print(f"DEBUG: Time Window -> Start: {start_ts} | End: {end_ts}")
    
    client = ClobClient(host=CLOB_HOST, chain_id=CHAIN_ID)
    
    try:
        # Fetch 1 minute intervals
        resp = await client.get_price_history_with_timestamps(
            token_id=token_id,
            start_ts=int(start_ts),
            end_ts=int(end_ts),
            fidelity=60 
        )
        
        history = resp.get("history", [])
        if not history:
            print("DEBUG: WARNING -> CLOB Client returned NO history data.")
            return pd.DataFrame()
            
        df = pd.DataFrame(history)
        df = df.rename(columns={'t': 'Timestamp', 'p': 'Poly_Probability'})
        df['Timestamp'] = pd.to_datetime(df['Timestamp'], unit='s', utc=True)
        
        print(f"DEBUG: CLOB Data Fetched -> {len(df)} rows.")
        return df
        
    except Exception as e:
        print(f"DEBUG: CLOB Client Exception: {e}")
        return pd.DataFrame()

def get_spx_data():
    """Fetches S&P 500 minute-by-minute data via yfinance."""
    print("DEBUG: Fetching S&P 500 Data from yfinance...")
    
    try:
        df = yf.download(SPX_TICKER, period="1d", interval="1m", progress=False)
        
        if df.empty: 
            print("DEBUG: ERROR -> yfinance returned empty DataFrame.")
            return pd.DataFrame()
        
        df = df.reset_index()
        # Ensure UTC
        if df['Datetime'].dt.tz is None:
            df['Datetime'] = df['Datetime'].dt.tz_localize('UTC')
        else:
            df['Datetime'] = df['Datetime'].dt.tz_convert('UTC')
            
        df = df.rename(columns={'Datetime': 'Timestamp', 'Close': 'SPX_Price', 'Volume': 'SPX_Volume'})
        clean_df = df[['Timestamp', 'SPX_Price', 'SPX_Volume']]
        
        print(f"DEBUG: SPX Data Fetched -> {len(clean_df)} rows.")
        return clean_df
        
    except Exception as e:
        print(f"DEBUG: yfinance Exception: {e}")
        return pd.DataFrame()

def save_data(df):
    print(f"DEBUG: Attempting to save {len(df)} rows to Excel...")
    os.makedirs(os.path.dirname(EXCEL_FILE_PATH), exist_ok=True)
    
    if os.path.exists(EXCEL_FILE_PATH):
        print("DEBUG: Found existing Excel file. Appending...")
        existing = pd.read_excel(EXCEL_FILE_PATH)
        df = pd.concat([existing, df], ignore_index=True)
    else:
        print("DEBUG: Creating new Excel file...")
    
    try:
        with pd.ExcelWriter(EXCEL_FILE_PATH, engine='openpyxl') as writer:
            df.to_excel(writer, index=False)
        print(f"DEBUG: SUCCESS -> Saved total {len(df)} rows to {EXCEL_FILE_PATH}")
    except Exception as e:
        print(f"DEBUG: File Save Error: {e}")

async def main():
    print("--- STARTING MARKET TRACKER ---")
    slug = get_todays_slug()
    if not slug: 
        print("DEBUG: Exiting Main (No Slug).")
        return

    # 1. Get the correct Token ID (Asset ID)
    token_id = get_token_id_from_slug(slug)
    if not token_id: 
        print("DEBUG: Exiting Main (No Token ID).")
        return

    # 2. Get S&P Data to define the time window
    spx_df = get_spx_data()
    if spx_df.empty: 
        print("DEBUG: Exiting Main (No SPX Data).")
        return
    
    start_ts = spx_df['Timestamp'].min().timestamp()
    end_ts = spx_df['Timestamp'].max().timestamp()

    # 3. Get CLOB Data using the Client
    poly_df = await fetch_clob_history(token_id, start_ts, end_ts)
    if poly_df.empty: 
        print("DEBUG: Exiting Main (No Polymarket Data).")
        return

    # 4. Merge
    print("DEBUG: Sorting and Merging Data...")
    spx_df = spx_df.sort_values('Timestamp')
    poly_df = poly_df.sort_values('Timestamp')
    
    merged = pd.merge_asof(
        spx_df, poly_df, 
        on='Timestamp', 
        direction='nearest', 
        tolerance=pd.Timedelta("60s")
    )
    
    rows_before = len(merged)
    merged = merged.dropna(subset=['Poly_Probability'])
    rows_after = len(merged)
    
    print(f"DEBUG: Merge Stats -> Rows Before DropNA: {rows_before} | Rows After DropNA: {rows_after}")

    if rows_after == 0:
        print("DEBUG: WARNING -> All rows were dropped! (Timestamps didn't align or data was NaN)")
        return

    merged['Date_Collected'] = datetime.now().strftime("%Y-%m-%d")
    
    save_data(merged)

if __name__ == "__main__":
    asyncio.run(main())