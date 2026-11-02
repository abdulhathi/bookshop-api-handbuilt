import express from 'express'
import { echoRouter } from './echo.js'

export function createApp() {
  const app = express()
  app.use(express.json())
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' })
  })
  app.use(echoRouter)
  return app
}
