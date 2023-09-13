import path from "path"
import dotenv from "dotenv"
dotenv.config({ path: path.join(__dirname, "../.env") })
import http from "http"
import express from "express"
import cors from "cors"
import child_process from "child_process"
import { WebSocketServer } from "ws"
import { URL } from "url"

const { PORT, SMART_TRANSCODE, STREAMING_SERVICE_BASE_URL } = process.env
const port = Number(PORT || 8080)
const transcode = SMART_TRANSCODE || true

const app = express()
app.use(express.json()) // for parsing application/json
app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded
app.use(cors())

// Create the HTTP server
const server = http.createServer(app)

server.listen({ port }, () => {
  console.log(`Server ready at port: ${port}`)
})

const wss = new WebSocketServer({
  server: server,
})

wss.on("connection", (ws, req) => {
  console.log("Streaming socket connected")
  ws.send("WELL HELLO THERE FRIEND")

  if (!req.url) return
  console.log("req url -->", req.url)

  const queryString = new URL(`ws://${STREAMING_SERVICE_BASE_URL}${req.url}`)
    .search
  const params = new URLSearchParams(queryString)
  const baseUrl = "rtmps://live.cloudflare.com:443/live"
  const key = params.get("key")
  const video = params.get("video")
  const audio = params.get("audio")

  const rtmpUrl = `${baseUrl}/${key}`

  const videoCodec =
    video === "h264" && !transcode
      ? ["-c:v", "copy"]
      : // video codec config: low latency, adaptive bitrate
        [
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-tune",
          "zerolatency",
          "-vf",
          "scale=w=-2:0",
        ]

  const audioCodec =
    audio === "aac" && !transcode
      ? ["-c:a", "copy"]
      : // audio codec config: sampling frequency (11025, 22050, 44100), bitrate 64 kbits
        ["-c:a", "aac", "-ar", "44100", "-b:a", "64k"]

  const ffmpeg = child_process.spawn("ffmpeg", [
    "-i",
    "-",

    //force to overwrite
    "-y",

    // used for audio sync
    "-use_wallclock_as_timestamps",
    "1",
    "-async",
    "1",

    ...videoCodec,

    ...audioCodec,
    //'-filter_complex', 'aresample=44100', // resample audio to 44100Hz, needed if input is not 44100
    //'-strict', 'experimental',
    "-bufsize",
    "1000",
    "-f",
    "flv",

    rtmpUrl,
  ])

  // Kill the WebSocket connection if ffmpeg dies.
  ffmpeg.on("close", (code, signal) => {
    console.log(
      "FFmpeg child process closed, code " + code + ", signal " + signal
    )
    ws.terminate()
  })

  // Handle STDIN pipe errors by logging to the console.
  // These errors most commonly occur when FFmpeg closes and there is still
  // data to write.f If left unhandled, the server will crash.
  ffmpeg.stdin.on("error", (e) => {
    console.log("FFmpeg STDIN Error", e)
  })

  // FFmpeg outputs all of its messages to STDERR. Let's log them to the console.
  ffmpeg.stderr.on("data", (data) => {
    ws.send("ffmpeg got some data")
    console.log("FFmpeg STDERR:", data.toString())
  })

  ws.on("message", (msg) => {
    if (Buffer.isBuffer(msg)) {
      console.log("this is some video data")
      ffmpeg.stdin.write(msg)
    } else {
      console.log(msg)
    }
  })

  ws.on("close", (e) => {
    console.log("shit got closed, yo")
    ffmpeg.kill("SIGINT")
  })
})
