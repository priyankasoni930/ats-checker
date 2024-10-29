const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pdf = require("pdf-parse");
const fs = require("fs");
require("dotenv").config(); // Add this line to load .env file

const app = express();

// Verify API key is loaded
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("GEMINI_API_KEY not found in environment variables");
  process.exit(1);
}

// Update CORS configuration
app.use(
  cors({
    origin: "https://resume-ace.vercel.app", // Update this to match your frontend URL
    methods: ["POST", "GET", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
  })
);

// These middleware declarations should come BEFORE your routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Initialize Gemini AI with verified API key
const genAI = new GoogleGenerativeAI(API_KEY);

// Helper function to extract text from PDF
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
  } catch (error) {
    console.error("PDF extraction error:", error);
    throw new Error("Failed to extract text from PDF");
  }
}

// Helper function to clean up uploaded file
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("Error cleaning up file:", error);
  }
}

app.post("/api/ats-check", upload.single("resume"), async (req, res) => {
  let filePath = null;

  try {
    // Log the API key (first few characters) for debugging
    console.log(
      "Using API key starting with:",
      API_KEY.substring(0, 5) + "..."
    );

    // Check if file was uploaded
    if (!req.file) {
      throw new Error("No file uploaded");
    }

    filePath = req.file.path;
    console.log("Processing file:", filePath);

    // Extract text from PDF
    const pdfText = await extractTextFromPDF(filePath);

    if (!pdfText || pdfText.trim().length === 0) {
      throw new Error("Could not extract text from PDF");
    }

    // Initialize Gemini model
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `You are an ATS (Applicant Tracking System) expert. Analyze this resume and provide:
    1. A score from 0-100 based on ATS compatibility
    2. Key findings about the resume's ATS-friendliness
    3. Specific suggestions for improvement

    Resume content:
    ${pdfText}

    Provide the response in the following JSON format only:
    {
      "score": number,
      "findings": [string],
      "suggestions": [string]
    }`;

    console.log("Sending request to Gemini API...");
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    try {
      // Parse the JSON response
      const parsedResponse = JSON.parse(responseText);

      // Validate the response format
      if (!parsedResponse.score || !Array.isArray(parsedResponse.suggestions)) {
        throw new Error("Invalid response format from AI");
      }

      res.json({
        score: parsedResponse.score,
        findings: parsedResponse.findings || [],
        suggestions: parsedResponse.suggestions,
      });
    } catch (parseError) {
      console.error("Parse error:", parseError);
      // Fallback in case of parsing error
      const scoreMatch = responseText.match(/\d+/);
      const score = scoreMatch ? parseInt(scoreMatch[0]) : 70;

      res.json({
        score: score,
        findings: ["Analysis completed"],
        suggestions: ["Consider reviewing the resume format"],
      });
    }
  } catch (error) {
    console.error("Error in ATS check:", error);
    res.status(500).json({
      error: error.message || "Failed to check ATS score",
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  } finally {
    // Clean up uploaded file
    if (filePath) {
      cleanupFile(filePath);
    }
  }
});

app.get("/", (req, res) => {
  res.send("ATS Check API is running");
});

// Add this route after the existing ATS check route

app.post(
  "/api/generate-cover-letter",
  upload.single("resume"),
  async (req, res) => {
    let filePath = null;

    try {
      // Check if file and job description were provided
      if (!req.file) {
        throw new Error("No resume file uploaded");
      }

      if (!req.body.jobDescription) {
        throw new Error("No job description provided");
      }

      filePath = req.file.path;

      // Extract text from PDF
      const resumeText = await extractTextFromPDF(filePath);

      if (!resumeText || resumeText.trim().length === 0) {
        throw new Error("Could not extract text from resume PDF");
      }

      // Initialize Gemini model
      const model = genAI.getGenerativeModel({ model: "gemini-pro" });

      const prompt = `You are a professional cover letter writer. Using the provided resume and job description, create a compelling cover letter. The cover letter should:
    1. Be tailored to the specific job
    2. Highlight relevant experience from the resume
    3. Show enthusiasm for the role
    4. Be professional but personable
    5. Be around 300-400 words

    Resume content:
    ${resumeText}

    Job Description:
    ${req.body.jobDescription}

   Provide the response in the following JSON format only:
    {
      "coverLetter": string (the complete cover letter),
    }`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      try {
        // Parse the JSON response
        const parsedResponse = JSON.parse(responseText);

        // Validate the response format
        if (
          !parsedResponse.coverLetter 
        ) {
          throw new Error("Invalid response format from AI");
        }

        res.json({
          coverLetter: parsedResponse.coverLetter,
        });
      } catch (parseError) {
        // Fallback in case of parsing error
        console.error("Parse error:", parseError);

        // Extract the content between common letter opening/closing phrases as a fallback
        const letterContent = responseText.replace(/[\r\n]+/g, "\n").trim();

        res.json({
          coverLetter: letterContent,
          highlights: [
            "Letter generated based on your resume and job description",
          ],
          suggestedImprovements: [
            "Consider reviewing and personalizing the generated content",
          ],
        });
      }
    } catch (error) {
      console.error("Error in cover letter generation:", error);
      res.status(500).json({
        error: error.message || "Failed to generate cover letter",
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    } finally {
      // Clean up uploaded file
      if (filePath) {
        cleanupFile(filePath);
      }
    }
  }
);

app.post("/api/generate-cover-letter/text", async (req, res) => {
  try {
    console.log("Received request body:", req.body); // Debugging line

    const { jobDescription, skillsExperience } = req.body;

    // Validate required fields
    if (!jobDescription || !skillsExperience) {
      return res.status(400).json({
        success: false,
        error: "Both job description and skills/experience are required",
      });
    }

    // Initialize Gemini model
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Make sure to use the correct env variable
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `You are a professional cover letter writer. Using the provided skills/experience and job description, create a compelling cover letter. The cover letter should: 
    1. Be tailored to the specific job 
    2. Highlight relevant experience from the provided background 
    3. Show enthusiasm for the role 
    4. Be professional but personable 
    5. Be around 300-400 words

    Candidate's Skills and Experience: ${skillsExperience}
    Job Description: ${jobDescription}

    Provide the response in the following JSON format only: 
    {
      "coverLetter": string (the complete cover letter),
    }`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    try {
      const parsedResponse = JSON.parse(responseText);

      if (!parsedResponse.coverLetter) {
        throw new Error("Invalid response format from AI");
      }

      return res.json({
        success: true,
        data: {
          coverLetter: parsedResponse.coverLetter,
        },
      });
    } catch (parseError) {
      console.error("Parse error:", parseError);
      const letterContent = responseText.replace(/[\r\n]+/g, "\n").trim();

      return res.json({
        success: true,
        data: {
          coverLetter: letterContent,
          highlights: [
            "Letter generated based on your background and job description",
          ],
          suggestedImprovements: [
            "Consider reviewing and personalizing the generated content",
          ],
        },
      });
    }
  } catch (error) {
    console.error("Error generating cover letter:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to generate cover letter",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log("API Key status:", API_KEY ? "Found" : "Missing");
  console.log(`Server URL: http://localhost:${port}`);
});
