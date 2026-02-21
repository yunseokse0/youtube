const http = require('http');
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('default-state.json', 'utf8'));

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