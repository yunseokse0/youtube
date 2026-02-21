const http = require('http');

const data = {
  members: [
    { id: "m1", name: "테스트멤버1", account: 150000, toon: 50000 },
    { id: "m2", name: "테스트멤버2", account: 230000, toon: 30000 }
  ],
  donors: [
    { id: "d1", name: "후원자1", amount: 100000, memberId: "m1", at: Date.now() }
  ],
  forbiddenWords: ["금칙어", "욕설"],
  overlaySettings: {
    scale: 1,
    memberSize: 24,
    totalSize: 64,
    dense: false,
    anchor: "tl",
    sumAnchor: "bc",
    sumFree: false,
    sumX: 50,
    sumY: 90,
    theme: "default",
    showMembers: true,
    showTotal: true,
    showGoal: true,
    goal: 1000000,
    goalLabel: "목표 금액",
    goalWidth: 400,
    goalAnchor: "bc",
    showTicker: true,
    showTimer: false,
    timerStart: null,
    timerAnchor: "tr",
    showMission: false,
    missionAnchor: "br"
  },
  updatedAt: Date.now()
};

const postData = JSON.stringify(data);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/state',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  
  res.setEncoding('utf8');
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:', responseData);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(postData);
req.end();