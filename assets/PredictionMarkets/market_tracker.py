import asyncio
import pandas as pd
import yfinance as yf
import os
import requests
from datetime import datetime, timedelta, timezone

# Import the CLOB Client
try:
    from py_clob_client.client import ClobClient
except ImportError:
    print("CRITICAL ERROR: 'py-clob-client' is not installed.")
    ClobClient = None

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

    # Optional: Comment out this block to test on weekends
    if now_et.weekday() >= 5:
        print("DEBUG: Status -> Weekend detected. No S&P 500 market. Exiting.")
        return None

    month = now_et.strftime("%B").lower()
    day = now_et.day
    year = now_et.year
    
    slug = f"spx-up-or-down-on-{month}-{day}-{year}"
    print(f"DEBUG: Generated Target Slug: {slug}")
    return slug

def get_market_question_from_gamma(slug):
    """
    Uses Gamma ONLY to get the exact Question String.
    """
    gamma_url = f"https://gamma-api.polymarket.com/markets?slug={slug}"
    try:
        print(f"DEBUG: Querying Gamma API for Question String: {slug}")
        resp = requests.get(gamma_url)
        resp.raise_for_status()
        data = resp.json()
        
        if not data:
            print(f"DEBUG: ERROR -> Slug not found in Gamma API: {slug}")
            return None
            
        market = data[0] if isinstance(data, list) else data
        question = market.get("question")
        print(f"DEBUG: Found Question: '{question}'")
        return question
            
    except Exception as e:
        print(f"DEBUG: Gamma Lookup Exception: {e}")
        return None

def get_token_id_via_clob(target_question):
    """
    Uses the CLOB Client (Synchronous) to fetch ALL markets and find the real Token ID.
    """
    if ClobClient is None: return None
    print("DEBUG: Fetching ALL markets from CLOB to find the correct Token ID...")
    
    client = ClobClient(host=CLOB_HOST, chain_id=CHAIN_ID)
    
    try:
        # REMOVED 'await' here
        markets_resp = client.get_markets()
        
        # Handle response structure (list or dict with 'data')
        if isinstance(markets_resp, dict):
            markets = markets_resp.get('data', [])
            if not markets and 'markets' in markets_resp:
                markets = markets_resp['markets']
        elif isinstance(markets_resp, list):
            markets = markets_resp
        else:
            markets = []

        if not markets:
            print("DEBUG: ERROR -> CLOB get_markets() returned nothing.")
            return None

        print(f"DEBUG: Scanned {len(markets)} markets from CLOB.")
        
        found_token_id = None
        
        for market in markets:
            if market.get("question") == target_question:
                outcome = market.get("outcome", "")
                if outcome in ["Yes", "Up"]:
                    found_token_id = market.get("asset_id") # Usually 'asset_id' or 'token_id' in CLOB
                    if not found_token_id:
                        found_token_id = market.get("condition_id") # Fallback
                        
                    print(f"DEBUG: MATCH FOUND! Token ID: {found_token_id} (Outcome: {outcome})")
                    return found_token_id
        
        print(f"DEBUG: ERROR -> Could not find 'Yes'/'Up' token for question: {target_question}")
        return None

    except Exception as e:
        print(f"DEBUG: CLOB ID Lookup Exception: {e}")
        return None

def fetch_clob_history(token_id, start_ts, end_ts):
    """
    Uses the official py-clob-client (Synchronous) to fetch history.
    """
    if ClobClient is None: return pd.DataFrame()
    
    print(f"DEBUG: Fetching CLOB history for Token {token_id}...")
    
    client = ClobClient(host=CLOB_HOST, chain_id=CHAIN_ID)
    
    try:
        # REMOVED 'await' here
        resp = client.get_candles(
            token_id=str(token_id), 
            interval="1m",
            start_ts=int(start_ts),
            end_ts=int(end_ts)
        )
        
        if not resp:
            print("DEBUG: WARNING -> CLOB Client returned empty response.")
            return pd.DataFrame()
            
        df = pd.DataFrame(resp)
        
        if df.empty:
            print("DEBUG: WARNING -> CLOB DataFrame is empty.")
            return df

        # Standardize columns
        if 'close' in df.columns:
             df = df.rename(columns={'close': 'Poly_Probability'})
        elif 'p' in df.columns:
             df = df.rename(columns={'p': 'Poly_Probability'})
             
        if 'timestamp' in df.columns:
             df = df.rename(columns={'timestamp': 'Timestamp'})
        elif 't' in df.columns:
             df = df.rename(columns={'t': 'Timestamp'})
        
        df['Timestamp'] = pd.to_datetime(df['Timestamp'], unit='s', utc=True)
        
        print(f"DEBUG: CLOB Data Fetched -> {len(df)} rows.")
        return df[['Timestamp', 'Poly_Probability']]
        
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
        if df['Datetime'].dt.tz is None:
            df['Datetime'] = df['Datetime'].dt.tz_localize('UTC')
        else:
            df['Datetime'] = df['Datetime'].dt.tz_convert('UTC')
            
        df = df.rename(columns={'Datetime': 'Timestamp', 'Close': 'SPX_Price', 'Volume': 'SPX_Volume'})
        return df[['Timestamp', 'SPX_Price', 'SPX_Volume']]
        
    except Exception as e:
        print(f"DEBUG: yfinance Exception: {e}")
        return pd.DataFrame()

def save_data(df):
    print(f"DEBUG: Attempting to save {len(df)} rows to Excel...")
    os.makedirs(os.path.dirname(EXCEL_FILE_PATH), exist_ok=True)
    
    if os.path.exists(EXCEL_FILE_PATH):
        existing = pd.read_excel(EXCEL_FILE_PATH)
        df = pd.concat([existing, df], ignore_index=True)
    
    try:
        with pd.ExcelWriter(EXCEL_FILE_PATH, engine='openpyxl') as writer:
            df.to_excel(writer, index=False)
        print(f"DEBUG: SUCCESS -> Saved {len(df)} rows.")
    except Exception as e:
        print(f"DEBUG: File Save Error: {e}")

# MAIN is still async because yfinance *can* be async, but here we run sync logic wrapped in it.
async def main():
    print("--- STARTING MARKET TRACKER ---")
    slug = get_todays_slug()
    if not slug: return

    # 1. Get Question String
    question = get_market_question_from_gamma(slug)
    if not question: return

    # 2. Get Real Token ID (Removed await)
    token_id = get_token_id_via_clob(question)
    if not token_id: return

    # 3. Get S&P Data
    spx_df = get_spx_data()
    if spx_df.empty: return
    
    start_ts = spx_df['Timestamp'].min().timestamp()
    end_ts = spx_df['Timestamp'].max().timestamp()

    # 4. Get CLOB History (Removed await)
    poly_df = fetch_clob_history(token_id, start_ts, end_ts)
    if poly_df.empty: return

    # 5. Merge
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
    
    if len(merged) > 0:
        save_data(merged)
    else:
        print("DEBUG: No matching timestamps found.")

if __name__ == "__main__":
    asyncio.run(main())