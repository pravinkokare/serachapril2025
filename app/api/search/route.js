//api/serach/route.js
import Groq from "groq-sdk";
import mongoose from "mongoose";
import fuzzysort from "fuzzysort";
import { createClient } from "redis";

// Initialize Groq API
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Connect to MongoDB (ensure connection is reused)
mongoose.connect(process.env.MONGODB_URI).then(() => console.log("✅ MongoDB connected")).catch((err) => console.error("❌ MongoDB connection error:", err));

// Connect to Redis (ensure connection is reused)
let redisClient;
try {
  redisClient = createClient({
    url: process.env.REDIS_URL,
  });
  redisClient.on('error', (err) => console.error('❌ Redis Client Error:', err));
  await redisClient.connect();
  console.log("✅ Redis connected");
} catch (err) {
  console.error("❌ Failed to connect to Redis:", err.message);
  redisClient = null; // Fallback to no caching if Redis fails
}

// Employee schema
const employeeSchema = new mongoose.Schema({
  id: Number,
  name: String,
  role: String,
  location: String,
  experience: Number,
  skills: [String],
});

employeeSchema.index({ name: "text", role: "text", location: "text", skills: "text" });
employeeSchema.index({ location: 1, experience: 1 }); // Additional index for common queries
const Employee = mongoose.models.Employee || mongoose.model("Employee", employeeSchema);

function normalize(str) {
  return str.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalize roles (e.g., "software eng" → "software engineer")
function normalizeRole(role) {
  const roleLower = role.toLowerCase().trim();
  if (["software eng", "soft eng", "sw eng", "swe"].includes(roleLower)) return "software engineer";
  if (["dev", "developer"].includes(roleLower)) return "developer";
  if (["qa", "quality assurance"].includes(roleLower)) return "qa engineer";
  if (["data sci", "data scientist"].includes(roleLower)) return "data scientist";
  return roleLower;
}

// Normalize skills and reject invalid ones
function normalizeSkill(skill) {
  const skillLower = skill.toLowerCase().trim();
  // Reject invalid skills
  const invalidSkills = ["all", "software", "engineer", "developer"];
  if (invalidSkills.includes(skillLower)) return null;

  if (["pthon", "python"].includes(skillLower)) return "Python";
  if (["java"].includes(skillLower)) return "Java";
  if (["c++", "cpp"].includes(skillLower)) return "C++";
  if (["javascript", "js"].includes(skillLower)) return "JavaScript";
  if (["node.js", "nodejs", "node"].includes(skillLower)) return "Node.js";
  return skill;
}

// Preprocess simple queries to generate filters
function preprocessQuery(query) {
  const trimmedQuery = query.trim().toLowerCase();
  const experienceMatch = trimmedQuery.match(/^(\d+)\s*(years|yrs|year)?$/i);
  const skillMatch = trimmedQuery.match(/^[a-zA-Z+.#-]+$/); // Match simple skill-like terms (e.g., "java", "c++", "node.js")
  const roleMatch = trimmedQuery.match(/^(software eng|soft eng|sw eng|swe|developer|dev|qa|data sci|data scientist|[a-zA-Z\s]+)$/i);

  const preprocessedFilters = {};

  // Handle special case: "all"
  if (trimmedQuery === "all") {
    return preprocessedFilters; // Empty filter to return all employees
  }

  if (experienceMatch) {
    const years = parseInt(experienceMatch[1], 10);
    preprocessedFilters.experience = years; // Exact match
  } else if (skillMatch) {
    const normalizedSkill = normalizeSkill(trimmedQuery);
    if (normalizedSkill) {
      preprocessedFilters.skills = { any: [normalizedSkill] };
    }
  } else if (roleMatch) {
    const normalizedRole = normalizeRole(trimmedQuery);
    preprocessedFilters.role = normalizedRole;
  }

  return preprocessedFilters;
}

async function getDistinctLocations() {
  if (!redisClient) {
    return await Employee.distinct("location");
  }

  try {
    const cachedLocations = await redisClient.get("distinct:locations");
    if (cachedLocations) {
      return JSON.parse(cachedLocations);
    }
    const locations = await Employee.distinct("location");
    await redisClient.set("distinct:locations", JSON.stringify(locations), { EX: 86400 }); // Cache for 24 hours
    return locations;
  } catch (err) {
    console.error("❌ Error fetching distinct locations:", err.message);
    return await Employee.distinct("location"); // Fallback to direct DB call
  }
}

async function processSearchQuery(query) {
  if (!redisClient) {
    console.warn("⚠️ Redis not available, skipping cache");
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You're a MongoDB filter generator. 
Only return valid JSON enclosed between JSON_OUTPUT_START and JSON_OUTPUT_END. Do NOT include any explanation.

Allowed keys:
- role: string
- location: string
- experience: object (e.g. { "$lte": 5 }) or number (e.g. 10 for exact match)
- skills: object with "any" or "all" arrays

Handle special cases:
- If the query is "all", return {} to match all employees.
- If the query is a single word like "java", assume it's a skill and return {"skills": {"any": ["java"]}}. Do NOT treat "software", "engineer", or "all" as skills.
- If the query is a number with "years" (e.g., "10 years"), return {"experience": 10} for an exact match.
- If the query looks like a role (e.g., "software eng", "developer"), return {"role": "software engineer"} or {"role": "developer"}. Normalize "software eng", "soft eng", "sw eng", or "swe" to "software engineer".

Example outputs:
For query "all":
JSON_OUTPUT_START
{}
JSON_OUTPUT_END

For query "java":
JSON_OUTPUT_START
{"skills": {"any": ["java"]}}
JSON_OUTPUT_END

For query "10 years":
JSON_OUTPUT_START
{"experience": 10}
JSON_OUTPUT_END

For query "software eng":
JSON_OUTPUT_START
{"role": "software engineer"}
JSON_OUTPUT_END

For query "developer":
JSON_OUTPUT_START
{"role": "developer"}
JSON_OUTPUT_END

For query "software engineer in mumbai with 5 years experience":
JSON_OUTPUT_START
{
  "role": "software engineer",
  "location": "mumbai",
  "experience": {"$gte": 5}
}
JSON_OUTPUT_END`,
        },
        {
          role: "user",
          content: `Extract filters from: "${query}"`,
        },
      ],
      model: "llama3-70b-8192",
    });
    return completion.choices[0]?.message?.content || "";
  }

  let cached;
  try {
    cached = await redisClient.get(`aiQuery:${query}`);
    if (cached) {
      console.log("⚡ Using cached AI filters from Redis");
      return cached;
    }
  } catch (err) {
    console.error("❌ Redis cache error:", err.message);
  }

  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: `You're a MongoDB filter generator. 
Only return valid JSON enclosed between JSON_OUTPUT_START and JSON_OUTPUT_END. Do NOT include any explanation.

Allowed keys:
- role: string
- location: string
- experience: object (e.g. { "$lte": 5 }) or number (e.g. 10 for exact match)
- skills: object with "any" or "all" arrays

Handle special cases:
- If the query is "all", return {} to match all employees.
- If the query is a single word like "java", assume it's a skill and return {"skills": {"any": ["java"]}}. Do NOT treat "software", "engineer", or "all" as skills.
- If the query is a number with "years" (e.g., "10 years"), return {"experience": 10} for an exact match.
- If the query looks like a role (e.g., "software eng", "developer"), return {"role": "software engineer"} or {"role": "developer"}. Normalize "software eng", "soft eng", "sw eng", or "swe" to "software engineer".

Example outputs:
For query "all":
JSON_OUTPUT_START
{}
JSON_OUTPUT_END

For query "java":
JSON_OUTPUT_START
{"skills": {"any": ["java"]}}
JSON_OUTPUT_END

For query "10 years":
JSON_OUTPUT_START
{"experience": 10}
JSON_OUTPUT_END

For query "software eng":
JSON_OUTPUT_START
{"role": "software engineer"}
JSON_OUTPUT_END

For query "developer":
JSON_OUTPUT_START
{"role": "developer"}
JSON_OUTPUT_END

For query "software engineer in mumbai with 5 years experience":
JSON_OUTPUT_START
{
  "role": "software engineer",
  "location": "mumbai",
  "experience": {"$gte": 5}
}
JSON_OUTPUT_END`,
      },
      {
        role: "user",
        content: `Extract filters from: "${query}"`,
      },
    ],
    model: "llama3-70b-8192",
  });

  const aiResponse = completion.choices[0]?.message?.content || "";
  try {
    await redisClient.set(`aiQuery:${query}`, aiResponse, { EX: 3600 });
  } catch (err) {
    console.error("❌ Redis set error:", err.message);
  }
  return aiResponse;
}

function extractJsonFromResponse(aiResponse) {
  const match = aiResponse.match(/JSON_OUTPUT_START([\s\S]*?)JSON_OUTPUT_END/);
  if (!match) {
    console.warn("⚠️ Could not find JSON in AI response.");
    return {};
  }

  try {
    const parsed = JSON.parse(match[1].trim());
    console.log("Parsed AI Filters:", parsed);
    return parsed;
  } catch (err) {
    console.error("❌ JSON parse error:", err.message);
    return {};
  }
}

async function buildMongoQuery(parsed, query, distinctLocations, preprocessedFilters) {
  const mongoQuery = {};

  const createFuzzyRegex = (str) => {
    const escapedStr = normalize(str);
    return `.*${escapedStr}.*`;
  };

  // Use preprocessed filters if AI parsing fails
  if (Object.keys(parsed).length === 0 && Object.keys(preprocessedFilters).length > 0) {
    parsed = preprocessedFilters;
    console.log("Using preprocessed filters:", parsed);
  }

  // Only set location if explicitly provided
  if (parsed.location) {
    let locationToSearch = parsed.location;
    const exactMatch = distinctLocations.find(
      loc => loc.toLowerCase() === locationToSearch.toLowerCase()
    );

    if (!exactMatch) {
      const results = fuzzysort.go(locationToSearch, distinctLocations, { threshold: -100, limit: 1 });
      if (results.length > 0) {
        const bestMatch = results[0].target;
        console.log(`Fuzzy matched location: "${locationToSearch}" → "${bestMatch}"`);
        mongoQuery.location = { $regex: `^${bestMatch}$`, $options: "i" };
      } else {
        const fuzzyPattern = createFuzzyRegex(locationToSearch.trim());
        mongoQuery.location = { $regex: fuzzyPattern, $options: "i" };
      }
    } else {
      mongoQuery.location = { $regex: `^${exactMatch}$`, $options: "i" };
    }
  }

  if (parsed.role) {
    const fuzzyPattern = createFuzzyRegex(parsed.role);
    mongoQuery.role = { $regex: fuzzyPattern, $options: "i" };
  }

  if (parsed.experience) {
    // Handle both exact matches (e.g., 10) and range queries (e.g., {"$gte": 5})
    if (typeof parsed.experience === "number") {
      mongoQuery.experience = parsed.experience;
    } else {
      mongoQuery.experience = parsed.experience;
    }
  }

  if (parsed.skills) {
    if (parsed.skills.all) {
      const normalizedSkills = parsed.skills.all
        .map((s) => normalizeSkill(s))
        .filter((s) => s !== null); // Filter out invalid skills
      if (normalizedSkills.length > 0) {
        mongoQuery.skills = {
          $all: normalizedSkills.map((s) => new RegExp(createFuzzyRegex(s), "i")),
        };
      }
    } else if (parsed.skills.any) {
      const normalizedSkills = parsed.skills.any
        .map((s) => normalizeSkill(s))
        .filter((s) => s !== null); // Filter out invalid skills
      if (normalizedSkills.length > 0) {
        mongoQuery.skills = {
          $in: normalizedSkills.map((s) => new RegExp(createFuzzyRegex(s), "i")),
        };
      }
    }
  }

  console.log("MongoDB Query:", JSON.stringify(mongoQuery, null, 2));
  return mongoQuery;
}

async function searchEmployees(query, page = 1, pageSize = 20) {
  if (!query || typeof query !== "string") {
    throw new Error("Query must be a non-empty string");
  }

  const start = Date.now();
  const skip = (page - 1) * pageSize;
  const distinctLocations = await getDistinctLocations();
  
  // Preprocess the query
  const preprocessedFilters = preprocessQuery(query);
  
  const aiResponse = await processSearchQuery(query);
  const parsed = extractJsonFromResponse(aiResponse);
  const mongoQuery = await buildMongoQuery(parsed, query, distinctLocations, preprocessedFilters);

  let results;
  let totalCount;
  let usedFallback = false;

  if (Object.keys(mongoQuery).length === 0) {
    console.log("Using enhanced fallback for role search");
    // Enhanced fallback: try a fuzzy regex search on role if query looks like a role
    const normalizedQuery = normalizeRole(query.trim());
    const fuzzyPattern = createFuzzyRegex(normalizedQuery);
    results = await Employee.find({ role: { $regex: fuzzyPattern, $options: "i" } }).skip(skip).limit(pageSize);
    totalCount = await Employee.countDocuments({ role: { $regex: fuzzyPattern, $options: "i" } });
    usedFallback = true;

    // Special case: if query is "all", return all employees
    if (query.trim().toLowerCase() === "all") {
      results = await Employee.find({}).skip(skip).limit(pageSize);
      totalCount = await Employee.countDocuments({});
      usedFallback = true;
      console.log("Returning all employees for query 'all'");
    }
  } else {
    results = await Employee.find(mongoQuery).skip(skip).limit(pageSize);
    totalCount = await Employee.countDocuments(mongoQuery);
  }

  console.log(`Query executed in ${Date.now() - start}ms`);
  return { results, totalCount, usedFallback, page, pageSize };
}

export async function POST(req) {
  const { query, page = 1, pageSize = 20 } = await req.json();

  if (!query) {
    return new Response(JSON.stringify({ message: "Query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { results, totalCount, usedFallback, page: currentPage, pageSize: currentPageSize } = await searchEmployees(query, page, pageSize);
    return new Response(JSON.stringify({
      results,
      totalCount,
      usedFallback,
      page: currentPage,
      pageSize: currentPageSize,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("❌ Search error:", error.message);
    return new Response(JSON.stringify({ message: "Internal Server Error", error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}