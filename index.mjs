import fs from "fs"
import http from "http"
import { error } from "./error.mjs"
import cliProgress from "cli-progress"

const sizeFormatter = (bytes) => {
  const sizeInMB = bytes / (1024 * 1024)
  return Math.round(sizeInMB * 100) / 100 // Round to two decimal places
}

const downloadFile = (outputPath, fileName, link, retries = 3) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath + fileName)
    const request = http.get(link, (response) => {
      if (response.statusCode !== 200) {
        file.close()
        fs.unlink(outputPath + fileName, () => {}) // Delete the file async
        return reject(`Failed to get '${link}' (${response.statusCode})`)
      }

      const totalSize = parseInt(response.headers["content-length"], 10)
      let downloadedSize = 0

      console.log(`\nDownloading file: ${fileName}...`)

      const bar = new cliProgress.SingleBar({
        format: "{bar} {percentage}% | {value}/{total} MB | Speed: {speed} KB/s",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
      })

      bar.start(sizeFormatter(totalSize), 0, {
        speed: "N/A",
      })

      response.on("data", (chunk) => {
        file.write(chunk)
        downloadedSize += chunk.length
        const speed = (downloadedSize / ((Date.now() - startTime) / 1000) / 1024).toFixed(2)
        bar.update(sizeFormatter(downloadedSize), {
          speed,
          value: (downloadedSize / 1024 / 1024).toFixed(2),
        })
      })

      response.on("end", () => {
        file.end()
        bar.stop()
        console.log(`File ${fileName} downloaded!\n`)
        resolve()
      })

      response.on("error", (err) => {
        fs.unlink(outputPath + fileName, () => {
          if (retries > 0) {
            console.log(`Retrying download: ${fileName}... (${retries} retries left)`)
            resolve(downloadFile(outputPath, fileName, link, retries - 1))
          } else {
            fs.appendFile(
              "logs.txt",
              `Error while reading config file: ${fileName} - ${err}\n
              `,
            )
            resolve()
          }
        })
      })
    })

    request.on("error", (err) => {
      file.close()
      fs.unlink(outputPath + fileName, () => {
        if (retries > 0) {
          console.log(`Retrying download: ${fileName}... (${retries} retries left)`)
          resolve(downloadFile(outputPath, fileName, link, retries - 1))
        } else {
          fs.appendFile(
            "logs.txt",
            `Error while reading config file: ${fileName} - ${err}
            `,
          )
          resolve()
        }
      })
    })

    const startTime = Date.now()
  }).catch((msg) => {
    console.log(msg + " , skipping...")
  })
}

const generatePakPath = (value) => {
  const path = "00000000".slice(value.toString().length) + value
  return `${path}/Patch${path}.pak`
}

const generateOutputPath = (outputPath) => {
  const newDate = new Date()
  const time = newDate.toLocaleTimeString().replaceAll(":", ".")
  const dateTimePath = time + "/"
  return `${outputPath}/${dateTimePath}`
}

const downloadFromTo = async (from, to, output, baseUrl) => {
  const outputPath = generateOutputPath(output)
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true })
  }

  const downloadSequentially = async (current) => {
    if (current > to) {
      return
    }
    const generatedPakPath = generatePakPath(current)
    const fileName = generatedPakPath.split("/")[1]

    try {
      await downloadFile(outputPath, fileName, baseUrl + "/" + generatedPakPath)
      await downloadSequentially(current + 1)
    } catch (error) {
      console.error("Error downloading file:", fileName, error)
    }
  }

  await downloadSequentially(from)
}

fs.readFile("config.json", "utf-8", async (err, data) => {
  if (err) {
    console.error("Error while reading config file:", err)
    return
  }

  try {
    const config = JSON.parse(data)

    if (!config.baseUrl || !config.from || !config.to || !config.outputPath) {
      console.error(error)
      return
    }
    if (!fs.existsSync(config.outputPath)) {
      fs.mkdirSync(config.outputPath, { recursive: true })
    }

    await downloadFromTo(config.from, config.to, config.outputPath, config.baseUrl)
  } catch (error) {
    console.error("Error during file download:", error)
  }
})
