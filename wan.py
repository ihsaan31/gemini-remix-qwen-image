res = requests.post(
    "https://api.runpod.ai/v2/i83jbbmfx8zd9j/run",
    headers=headers,
    json={
        "input": {
            "prompt": """
A realistic cinematic vertical video of the same woman from the reference image.
She gently shows off her outfit in front of the camera, slowly turning her body,
adjusting her clothes naturally, confident casual pose, subtle smile.
Smooth handheld camera movement, realistic lighting, natural skin texture,
fashion lifestyle video, high detail, stable face, consistent identity,
realistic motion, no exaggerated movement.
""",
            "negative_prompt": """
blurry, low quality, distorted face, deformed hands, extra fingers, bad anatomy,
warped body, flickering, jitter, unstable face, duplicate person, melted face,
cartoon, anime, overexposed, underexposed, low resolution
""",
            "image_base64": image_base64,
            "width": 480,
            "height": 832,
            "length": 49,
            "steps": 30,
            "seed": 42,
            "cfg": 5.0
        }
    }
)

data = res.json()
print(data)

job_id = data["id"]
print(job_id)