import express, { type Request, type Response } from 'express'

export const echoRouter = express.Router()

const echo = (req: Request, res: Response) => {
  const query = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
  const headers: Record<string, unknown> = { ...req.headers }
  if (headers.authorization) headers.authorization = 'Bearer ***'
  res.json({ method: req.method, path: req.path, query, headers, body: req.body ?? null })
}

echoRouter.route('/v1/echo').get(echo).post(echo)
