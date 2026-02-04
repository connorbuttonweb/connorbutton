import requests
import pandas as pd
import os
from datetime import datetime

def fetch_polymarket_data():
    """Fetches data for a specific target market using its unique Market ID."""
    target_id = "1333010" 
    
    # Use the Gamma API direct Market ID endpoint
    url = f"https://gamma-api.polymarket.com/markets/{target_id}"
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        m = response.json()  # Get market by ID returns a single object
        
        if not m:
            print(f"No market data found for ID: {target_id}")
            return pd.DataFrame()

        # Build the data list from the market object
        data = [{
            "Timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "Market": m.get("question", "N/A"),
            "Last Price": m.get("lastTradePrice", 0),
            "Best Bid": m.get("bestBid", 0),
            "Best Ask": m.get("bestAsk", 0),
            "Spread": m.get("spread", 0),
            "1h Change": m.get("oneHourChange", 0),
            "Liquidity": m.get("liquidity", 0),
            "24 Hour Volume": m.get("volume24hr", 0),
            "Total Volume": m.get("volume", 0)
        }]
        return pd.DataFrame(data)
    except Exception as e:
        print(f"Error fetching data: {e}")
        return pd.DataFrame()

def save_data(df):
    """Saves the dataframe to the Excel file using a reliable relative path."""
    # This path is relative to the repository root where GitHub Actions runs
    file_path = "assets/PredictionMarkets/Prediction_Market_Master.xlsx"
    
    # Ensure the directory exists
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    
    try:
        if os.path.exists(file_path):
            existing_df = pd.read_excel(file_path)
            updated_df = pd.concat([existing_df, df], ignore_index=True)
            with pd.ExcelWriter(file_path, engine='openpyxl') as writer:
                updated_df.to_excel(writer, index=False)
        else:
            with pd.ExcelWriter(file_path, engine='openpyxl') as writer:
                df.to_excel(writer, index=False)
        print(f"Successfully saved to {file_path}")
    except Exception as e:
        print(f"Error saving data: {e}")

if __name__ == "__main__":
    market_df = fetch_polymarket_data()
    if not market_df.empty:
        save_data(market_df)