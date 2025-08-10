import requests
from dotenv import load_dotenv
import os

load_dotenv()
search_url = "https://google.serper.dev/search"
X_API_KEY= os.getenv("X-API-KEY")


def web_search(query:str):
    headers = {"X-API-KEY":X_API_KEY,
               "Content-Type": "application/json"}
    params ={"q":query}
    response = requests.post(search_url,json=params,headers=headers)
    print("Status Code:", response.status_code)
    print("Response Headers:", response.headers)
    print("Raw Response:", response.text[:500])
    results =response.json()
    return results