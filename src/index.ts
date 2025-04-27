import express from "express"
import cors from "cors"
import helmet from "helmet"
import morgan from "morgan"
import dotenv from "dotenv"
import { scanRoutes } from "./routes/scanRoutes"
import { reportRoutes } from "./routes/reportRoutes"
import { errorHandler } from "./middlewares/errorHandler"

// Load environment variables
dotenv.config()

// Create Express app
const app = express()
const port = process.env.PORT || 3001

// Apply middlewares
app.use(
  cors({
    // origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    origin: "*",
    credentials: true,
  })
)
app.use(helmet())
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Routes
app.use("/api/scan", scanRoutes)
app.use("/api/report", reportRoutes)

// Health check route
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "UP", timestamp: new Date().toISOString() })
})

// Error handling middleware
app.use(errorHandler)

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`)
  console.log(`Environment: ${process.env.NODE_ENV}`)
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`)
})

// For clean shutdown
process.on("SIGINT", () => {
  console.log("Shutting down server...")
  process.exit(0)
})

export default app
