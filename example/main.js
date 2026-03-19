import { encodePGN, decodePGN } from '../src/index.js'
import LZString from 'lz-string'
import { compress, decompress } from 'smol-string'

const pgnInput = document.getElementById('pgn')
const tagsInput = document.getElementById('tags')
const annotationsCheckbox = document.getElementById('annotations')
const processBtn = document.getElementById('process')
const resultDiv = document.getElementById('result')
const errorDiv = document.getElementById('error')
const encodedDiv = document.getElementById('encoded')
const decodedDiv = document.getElementById('decoded')
const statsDiv = document.getElementById('stats')

processBtn.addEventListener('click', async () => {
  resultDiv.style.display = 'none'
  errorDiv.style.display = 'none'
  processBtn.disabled = true
  processBtn.textContent = 'Processing...'

  try {
    const pgn = pgnInput.value.trim()
    if (!pgn) {
      throw new Error('Please enter a PGN string')
    }

    const tagsValue = tagsInput.value.trim()
    let tags = undefined
    if (tagsValue.length > 0) {
      tags = tagsValue.includes(',') ? tagsValue.split(',').map(t => t.trim()) : tagsValue
    }
    const options = {
      tags,
      includeAnnotations: annotationsCheckbox.checked
    }

    const encoded = await encodePGN(pgn, options)
    const decoded = await decodePGN(encoded)

    encodedDiv.textContent = encoded
    decodedDiv.textContent = decoded

    const lzCompressed = LZString.compressToEncodedURIComponent(pgn)
    const smolCompressed = compress(pgn)

    const methods = [
      { name: 'pgnpack', size: encoded.length },
      { name: 'lz-string', size: lzCompressed.length },
      { name: 'smol-string', size: smolCompressed.length },
    ]
    const minSize = Math.min(...methods.map(m => m.size))

    const statsHtml = [
      '<tr><th>Method</th><th>Size</th><th>Ratio</th></tr>',
      ...methods.map(m => {
        const ratio = (m.size / pgn.length * 100).toFixed(1)
        const isWinner = m.size === minSize
        return `<tr>
          <td class="${isWinner ? 'winner' : ''}">${m.name}${isWinner ? ' (best)' : ''}</td>
          <td class="${isWinner ? 'winner' : ''}">${m.size} chars</td>
          <td class="${isWinner ? 'winner' : ''}">${ratio}%</td>
        </tr>`
      })
    ].join('')

    statsDiv.innerHTML = statsHtml

    resultDiv.style.display = 'block'
  } catch (err) {
    errorDiv.textContent = err.message
    errorDiv.style.display = 'block'
  } finally {
    processBtn.disabled = false
    processBtn.textContent = 'Encode & Decode'
  }
})
