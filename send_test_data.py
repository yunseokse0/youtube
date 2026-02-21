import json
import requests
import time

timestamp = int(time.time() * 1000)

data = {
    "members": [
        {"id": "m1", "name": "테스트멤버1", "account": 150000, "toon": 50000},
        {"id": "m2", "name": "테스트멤버2", "account": 230000, "toon": 30000}
    ],
    "donors": [
        {"id": "d1", "name": "후원자1", "amount": 100000, "memberId": "m1", "at": timestamp}
    ],
    "forbiddenWords": ["금칙어", "욕설"],
    "overlaySettings": {
        "scale": 1,
        "memberSize": 24,
        "totalSize": 64,
        "dense": False,
        "anchor": "tl",
        "sumAnchor": "bc",
        "sumFree": False,
        "sumX": 50,
        "sumY": 90,
        "theme": "default",
        "showMembers": True,
        "showTotal": True,
        "showGoal": True,
        "goal": 1000000,
        "goalLabel": "목표 금액",
        "goalWidth": 400,
        "goalAnchor": "bc",
        "showTicker": True,
        "showTimer": False,
        "timerStart": None,
        "timerAnchor": "tr",
        "showMission": False,
        "missionAnchor": "br"
    },
    "updatedAt": timestamp
}

response = requests.post('http://localhost:3000/api/state', json=data)
print(f"Status: {response.status_code}")
print(f"Response: {response.text}")