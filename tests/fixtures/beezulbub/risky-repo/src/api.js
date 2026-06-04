// Risky API file with hardcoded credentials
const dbPassword = "hardcoded";
const apiKey = "sk-abc123";

async function getData() {
  const res = await fetch("https://api.example.com/data", {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  return res.json();
}

module.exports = { getData };
