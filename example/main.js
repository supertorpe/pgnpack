import { encodePGN, decodePGN } from '../src/index.js'

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
    statsDiv.textContent = `Original: ${pgn.length} chars | Encoded: ${encoded.length} chars | Ratio: ${(encoded.length / pgn.length * 100).toFixed(1)}%`

    resultDiv.style.display = 'block'
  } catch (err) {
    errorDiv.textContent = err.message
    errorDiv.style.display = 'block'
  } finally {
    processBtn.disabled = false
    processBtn.textContent = 'Encode & Decode'
  }
})
