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
    
    if now_et.weekday() >= 5:
        print("Today is a weekend. No S&P 500 market.")
        return None

    month = now_et.strftime("%B").lower()
    day = now_et.day
    year = now_et.year
    
    return f"spx-up-or-down-on-{month}-{day}-{year}"

def get_token_id_from_slug(slug):
    """
    CRITICAL STEP: We use Gamma to find the 'Token ID' (Asset ID).
    We do NOT use the CLOB client here because downloading all markets is too slow.
    """
    gamma_url = f"https://gamma-api.polymarket.com/markets?slug={slug}"
    try:
        resp = requests.get(gamma_url)
        resp.raise_for_status()
        data = resp.json()
        
        if not data:
            print(f"Slug not found: {slug}")
            return None
            
        market = data[0] if isinstance(data, list) else data
        
        # Gamma returns 'clobTokenIds' which matches outcomes ["No", "Yes"]
        # We need the Token ID for "Yes" (usually index 1)
        clob_ids = market.get("clobTokenIds", [])
        outcomes = market.get("outcomes", [])
        
        if "Yes" in outcomes:
            yes_index = outcomes.index("Yes")
            token_id = clob_ids[yes_index]
            print(f"Verified Token ID for 'Yes': {token_id}")
            return token_id
            
    except Exception as e:
        print(f"Gamma Lookup Error: {e}")
        return None

async def fetch_clob_history(token_id, start_ts, end_ts):
    """
    Uses the official py-clob-client to fetch history.
    """
    client = ClobClient(host=CLOB_HOST, chain_id=CHAIN_ID)
    
    try:
        # Note: We use the raw endpoint wrapper because the library's helper 
        # methods for history can vary by version. This is the most robust way.
        resp = await client.get_price_history_with_timestamps(
            token_id=token_id,
            start_ts=int(start_ts),
            end_ts=int(end_ts),
            fidelity=60 # 1 minute intervals
        )
        
        history = resp.get("history", [])
        if not history:
            print("CLOB Client returned no history.")
            return pd.DataFrame()
            
        df = pd.DataFrame(history)
        df = df.rename(columns={'t': 'Timestamp', 'p': 'Poly_Probability'})
        df['Timestamp'] = pd.to_datetime(df['Timestamp'], unit='s', utc=True)
        return df
        
    except Exception as e:
        print(f"CLOB Client Error: {e}")
        return pd.DataFrame()

def get_spx_data():
    """Fetches S&P 500 minute-by-minute data via yfinance."""
    print("Fetching S&P 500 Data...")
    df = yf.download(SPX_TICKER, period="1d", interval="1m", progress=False)
    if df.empty: return pd.DataFrame()
    
    df = df.reset_index()
    # Ensure UTC
    if df['Datetime'].dt.tz is None:
        df['Datetime'] = df['Datetime'].dt.tz_localize('UTC')
    else:
        df['Datetime'] = df['Datetime'].dt.tz_convert('UTC')
        
    df = df.rename(columns={'Datetime': 'Timestamp', 'Close': 'SPX_Price', 'Volume': 'SPX_Volume'})
    return df[['Timestamp', 'SPX_Price', 'SPX_Volume']]

def save_data(df):
    os.makedirs(os.path.dirname(EXCEL_FILE_PATH), exist_ok=True)
    if os.path.exists(EXCEL_FILE_PATH):
        existing = pd.read_excel(EXCEL_FILE_PATH)
        df = pd.concat([existing, df], ignore_index=True)
    
    with pd.ExcelWriter(EXCEL_FILE_PATH, engine='openpyxl') as writer:
        df.to_excel(writer, index=False)
    print(f"Saved {len(df)} rows.")

async def main():
    slug = get_todays_slug()
    if not slug: return

    # 1. Get the correct Token ID (Asset ID)
    token_id = get_token_id_from_slug(slug)
    if not token_id: return

    # 2. Get S&P Data to define the time window
    spx_df = get_spx_data()
    if spx_df.empty: return
    
    start_ts = spx_df['Timestamp'].min().timestamp()
    end_ts = spx_df['Timestamp'].max().timestamp()

    # 3. Get CLOB Data using the Client
    poly_df = await fetch_clob_history(token_id, start_ts, end_ts)
    if poly_df.empty: return

    # 4. Merge
    spx_df = spx_df.sort_values('Timestamp')
    poly_df = poly_df.sort_values('Timestamp')
    
    merged = pd.merge_asof(
        spx_df, poly_df, 
        on='Timestamp', 
        direction='nearest', 
        tolerance=pd.Timedelta("60s")
    )
    
    merged = merged.dropna(subset=['Poly_Probability'])
    merged['Date_Collected'] = datetime.now().strftime("%Y-%m-%d")
    
    save_data(merged)

if __name__ == "__main__":
    asyncio.run(main())