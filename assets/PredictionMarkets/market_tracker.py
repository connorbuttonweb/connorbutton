import requests
import pandas as pd
import os
from datetime import datetime, timedelta, timezone

def get_target_slug():
    now_utc = datetime.now(timezone.utc)
    # Note: If it's DST (March-Nov), change hours=-5 to hours=-4
    est_offset = timedelta(hours=-5)
    now_est = now_utc + est_offset

    if now_est.hour >= 16:
        target_date = now_est + timedelta(days=1)
    else:
        target_date = now_est

    # weekday() is 0 for Monday, 5 for Saturday, 6 for Sunday
    if target_date.weekday() == 5:  # If target is Saturday, move to Monday
        target_date += timedelta(days=2)
    elif target_date.weekday() == 6:  # If target is Sunday, move to Monday
        target_date += timedelta(days=1)

    month_name = target_date.strftime("%B").lower()
    day = target_date.day
    year = target_date.year
    
    return f"spx-up-or-down-on-{month_name}-{day}-{year}"

def fetch_polymarket_data():
    slug = get_target_slug()
    # Search for the market by slug via the Gamma API
    url = f"https://gamma-api.polymarket.com/markets?slug={slug}"
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        markets = response.json()
        
        # The search endpoint returns a list; we want the first match
        if not markets or (isinstance(markets, list) and len(markets) == 0):
            print(f"No market data found for slug: {slug}")
            return pd.DataFrame()

        m = markets[0] if isinstance(markets, list) else markets

        data = [{
            "Timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "Market": m.get("question", "N/A"),
            "Last Price": m.get("lastTradePrice", 0),
            "Best Bid": m.get("bestBid", 0),
            "Best Ask": m.get("bestAsk", 0),
            "Spread": m.get("spread", 0),
            "Liquidity": m.get("liquidity", 0),
            "24 Hour Volume": m.get("volume24hr", 0)
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