import { encodePGN, decodePGN } from '../src/index.js'
import LZString from 'lz-string'

const pgnInput = document.getElementById('pgn')
const tagsInput = document.getElementById('tags')
const allTagsCheckbox = document.getElementById('allTags')
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
    if (allTagsCheckbox.checked) {
      tags = true
    } else if (tagsValue.length > 0) {
      tags = tagsValue.includes(',') ? tagsValue.split(',').map(t => t.trim()) : [tagsValue]
    } else {
      tags = false
    }
    const options = {
      tags,
      annotations: annotationsCheckbox.checked
    }

    const encoded = await encodePGN(pgn, options)
    const decoded = await decodePGN(encoded)

    encodedDiv.textContent = encoded
    decodedDiv.textContent = decoded

    const lzOnDecoded = LZString.compressToEncodedURIComponent(decoded)
    document.getElementById('lz-on-decoded').textContent = lzOnDecoded

    const lzRoundtrip = LZString.decompressFromEncodedURIComponent(lzOnDecoded)
    document.getElementById('lz-on-decoded-roundtrip').textContent = lzRoundtrip === decoded ? 'OK' : 'MISMATCH'

    const methods = [
      { name: 'pgnpack', size: encoded.length },
      { name: 'lz-string', size: lzOnDecoded.length },
    ]
    const minSize = Math.min(...methods.map(m => m.size))

    const statsHtml = [
      '<tr><th>Method</th><th>Size</th><th>Ratio</th></tr>',
      ...methods.map(m => {
        const ratio = (m.size / decoded.length * 100).toFixed(1)
        const isWinner = m.size === minSize
        return `<tr>
          <td class="${isWinner ? 'winner' : ''}">${m.name}${isWinner ? ' (best)' : ''}</td>
          <td class="${isWinner ? 'winner' : ''}">${m.size} chars</td>
          <td class="${isWinner ? 'winner' : ''}">${ratio}%</td>
        </tr>`
      })
    ].join('')

    statsDiv.innerHTML = statsHtml

    document.getElementById('original-size').textContent = `${pgn.length} chars`
    document.getElementById('decoded-size').textContent = `${decoded.length} chars`

    resultDiv.style.display = 'block'
  } catch (err) {
    errorDiv.textContent = err.message
    errorDiv.style.display = 'block'
  } finally {
    processBtn.disabled = false
    processBtn.textContent = 'Encode & Decode'
  }
})
