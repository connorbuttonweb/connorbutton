import requests
import pandas as pd
from datetime import datetime
import os
import json

# --- SETTINGS ---
EXCEL_FILE = "Prediction_Market_Master.xlsx"
SHEET_NAME = "Sheet1"  # Targeted sheet for this specific trade
TARGET_MARKET_ID = "1325810" 

def fetch_comprehensive_data():
    print(f"Fetching full market metrics for ID: {TARGET_MARKET_ID}...")
    url = f"https://gamma-api.polymarket.com/markets/{TARGET_MARKET_ID}"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        m = response.json()
        
        last_up = float(m.get('lastTradePrice', 0))
        last_down = round(1.0 - last_up, 2) if last_up > 0 else 0
        
        return [{
            'Timestamp': datetime.now().strftime("%Y-%m-%d %H:%M"),
            'Market': m.get('question'),
            'Last_Up': last_up,
            'Last_Down': last_down,
            'Best_Bid': float(m.get('bestBid', 0)),
            'Best_Ask': float(m.get('bestAsk', 0)),
            'Spread': float(m.get('spread', 0)),
            'Liquidity': float(m.get('liquidity', 0)),
            '24h_Volume': float(m.get('volume24hr', 0))
        }]
    except Exception as e:
        print(f"Error fetching data: {e}")
        return []

def save_data(new_rows):
    if not new_rows:
        return
    
    folder = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(folder, EXCEL_FILE)
    df_new = pd.DataFrame(new_rows)
    
    # Use ExcelWriter to handle specific sheets without overwriting other sheets
    if os.path.exists(path):
        with pd.ExcelWriter(path, engine='openpyxl', mode='a', if_sheet_exists='overlay') as writer:
            try:
                # Try to load existing data from Sheet1
                df_old = pd.read_excel(path, sheet_name=SHEET_NAME)
                df_final = pd.concat([df_old, df_new], ignore_index=True)
                df_final.to_excel(writer, sheet_name=SHEET_NAME, index=False)
            except Exception:
                # If Sheet1 doesn't exist yet, just create it
                df_new.to_excel(writer, sheet_name=SHEET_NAME, index=False)
    else:
        df_new.to_excel(path, sheet_name=SHEET_NAME, index=False)
        
    print(f"Success! Data saved to {SHEET_NAME} in {EXCEL_FILE}")

if __name__ == "__main__":
    data = fetch_comprehensive_data()
    save_data(data)