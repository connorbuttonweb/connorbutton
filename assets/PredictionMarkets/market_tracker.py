import asyncio
import pandas as pd
import yfinance as yf
import os
import requests
from datetime import datetime, timedelta, timezone

# --- Configuration ---
SPX_TICKER = "^GSPC"
EXCEL_FILE_PATH = "assets/PredictionMarkets/Prediction_Market_Master.xlsx"
CLOB_HOST = "https://clob.polymarket.com"
CHAIN_ID = 137 # Polygon Mainnet

def get_todays_slug():
    """Generates the slug for the S&P 500 market that JUST closed."""
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

def get_gamma_details(slug):
    """
    Uses Gamma to get the Condition ID (The Key link to CLOB) and Question.
    """
    gamma_url = f"https://gamma-api.polymarket.com/markets?slug={slug}"
    try:
        print(f"DEBUG: Querying Gamma API for: {slug}")
        resp = requests.get(gamma_url)
        resp.raise_for_status()
        data = resp.json()
        
        if not data:
            print(f"DEBUG: ERROR -> Slug not found in Gamma API: {slug}")
            return None, None
            
        market = data[0] if isinstance(data, list) else data
        question = market.get("question")
        condition_id = market.get("conditionId")
        
        print(f"DEBUG: Found Question: '{question}'")
        print(f"DEBUG: Found Condition ID: '{condition_id}'")
        return condition_id, question
            
    except Exception as e:
        print(f"DEBUG: Gamma Lookup Exception: {e}")
        return None, None

def get_token_id_via_clob(condition_id, target_question):
    """
    Finds the 'Yes'/'Up' Token ID by querying CLOB via HTTP Requests.
    """
    if not condition_id: return None
    
    # --- STRATEGY 1: Direct Lookup (Fast) ---
    print(f"DEBUG: Attempting Direct CLOB Lookup for Condition ID: {condition_id}...")
    try:
        direct_url = f"{CLOB_HOST}/markets/{condition_id}"
        resp = requests.get(direct_url)
        
        if resp.status_code == 200:
            market = resp.json()
            token_id = extract_token_from_market(market, target_question)
            if token_id: 
                print(f"DEBUG: Direct Lookup Successful! Token ID: {token_id}")
                return token_id
    except Exception as e:
        print(f"DEBUG: Direct lookup failed ({e}). Switching to scan...")

    # --- STRATEGY 2: Pagination Scan (Thorough) ---
    print("DEBUG: Direct lookup failed. Starting full pagination scan of CLOB...")
    
    next_cursor = ""
    page_count = 0
    
    while True:
        page_count += 1
        print(f"DEBUG: Scanning Page {page_count}...")
        
        try:
            params = {}
            if next_cursor: params["next_cursor"] = next_cursor
            
            resp = requests.get(f"{CLOB_HOST}/markets", params=params)
            resp.raise_for_status()
            data = resp.json()
            
            markets = []
            if isinstance(data, list):
                markets = data
                next_cursor = None 
            elif isinstance(data, dict):
                markets = data.get("data", []) or data.get("markets", [])
                next_cursor = data.get("next_cursor", "")
            
            for market in markets:
                m_cond_id = market.get("condition_id") or market.get("conditionId")
                m_question = market.get("question")
                
                if m_cond_id == condition_id or m_question == target_question:
                    token_id = extract_token_from_market(market, target_question)
                    if token_id:
                        print(f"DEBUG: MATCH FOUND on Page {page_count}!")
                        return token_id
            
            if not next_cursor or next_cursor == "null":
                print("DEBUG: Reached end of market list. Market not found.")
                break
                
        except Exception as e:
            print(f"DEBUG: Pagination Error on page {page_count}: {e}")
            break
            
    return None

def extract_token_from_market(market, target_question):
    """Helper to parse a market object and find the 'Yes'/'Up' token."""
    try:
        tokens = market.get("tokens", [])
        for token in tokens:
            outcome = token.get("outcome", "")
            if outcome in ["Yes", "Up"]:
                t_id = token.get("token_id")
                return t_id
                
        outcome = market.get("outcome")
        if outcome in ["Yes", "Up"]:
            return market.get("asset_id") or market.get("token_id")

    except Exception as e:
        print(f"DEBUG: Error extracting token: {e}")
    return None

def fetch_clob_history(token_id, start_ts, end_ts):
    """
    Uses direct HTTP requests to fetch history (Bypassing py-clob-client).
    """
    print(f"DEBUG: Fetching CLOB history for Token {token_id}...")
    
    url = f"{CLOB_HOST}/prices-history"
    
    params = {
        "market": token_id,
        "startTs": int(start_ts),
        "endTs": int(end_ts),
        "fidelity": 1
    }
    
    try:
        resp = requests.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        
        history = data.get("history", [])
        
        if not history:
            print("DEBUG: WARNING -> CLOB API returned no history data.")
            return pd.DataFrame()
            
        df = pd.DataFrame(history)
        
        if 't' in df.columns and 'p' in df.columns:
             df = df.rename(columns={'t': 'Timestamp', 'p': 'Poly_Probability'})
        
        df['Timestamp'] = pd.to_datetime(df['Timestamp'], unit='s', utc=True)
        
        print(f"DEBUG: CLOB Data Fetched -> {len(df)} rows.")
        return df[['Timestamp', 'Poly_Probability']]
        
    except Exception as e:
        print(f"DEBUG: CLOB History Request Exception: {e}")
        return pd.DataFrame()

def get_spx_data():
    """Fetches S&P 500 minute-by-minute data via yfinance."""
    print("DEBUG: Fetching S&P 500 Data from yfinance...")
    
    try:
        df = yf.download(SPX_TICKER, period="1d", interval="1m", progress=False)
        
        if df.empty: 
            print("DEBUG: ERROR -> yfinance returned empty DataFrame.")
            return pd.DataFrame()
        
        # FIX: Flatten Multi-Index Columns
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

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
    
    # --- CRITICAL FIX: Remove Timezone Info for Excel Compatibility ---
    if 'Timestamp' in df.columns:
        df['Timestamp'] = df['Timestamp'].dt.tz_localize(None)
    # ------------------------------------------------------------------

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

async def main():
    print("--- STARTING MARKET TRACKER ---")
    slug = get_todays_slug()
    if not slug: return

    # 1. Get Condition ID from Gamma
    condition_id, question = get_gamma_details(slug)
    if not condition_id: return

    # 2. Get Real Token ID via CLOB
    token_id = get_token_id_via_clob(condition_id, question)
    if not token_id: return

    # 3. Get S&P Data
    spx_df = get_spx_data()
    if spx_df.empty: return
    
    start_ts = spx_df['Timestamp'].min().timestamp()
    end_ts = spx_df['Timestamp'].max().timestamp()

    # 4. Get CLOB History (Direct Request)
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