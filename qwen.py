import base64
import os
import requests

API_KEY = os.environ["RUNPOD_API_KEY"]
ENDPOINT_ID = "2qy0f4rw9djn7u"

with open("/content/owCBtpBniAsMQFFOA2JnEC4ekwxEIQAfgzoMui~tplv-sdweummd6v-text-logo-v1_QGFrdW5ucmlyaQ==_q75.jpeg", "rb") as f:
    image_base64 = base64.b64encode(f.read()).decode("utf-8")

res = requests.post(
    f"https://api.runpod.ai/v2/{ENDPOINT_ID}/runsync",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "input": {
            "prompt": "a hijab girl mirror selfieing using a dress",
            "image_base64": image_base64
        }
    },
)

print(res.json())
