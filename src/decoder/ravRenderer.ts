import { MoveNode } from "../types"

function renderVariationChain(node: MoveNode): string[] {
  const parts: string[] = [node.san]
  let current = node.variations[0]
  while (current) {
    if (current.variations.length > 1) {
      for (let i = 1; i < current.variations.length; i++) {
        parts[parts.length - 1] += ` (${renderVariationChain(current.variations[i]).join(" ")})`
      }
    }
    parts.push(current.san)
    current = current.variations[0]
  }
  return parts
}

export function renderRavTree(tree: MoveNode[], moveNumber = 1, isWhite = true): string {
  const moves: string[] = []
  
  for (const node of tree) {
    const prefix = isWhite ? `${moveNumber}. ` : ""
    let moveStr = `${prefix}${node.san}`
    
    if (node.variations.length > 0) {
      for (const variation of node.variations) {
        const varParts = renderVariationChain(variation)
        moveStr += ` (${varParts.join(" ")})`
      }
    }
    
    if (node.postText) {
      moveStr += ` ${node.postText}`
    }
    
    moves.push(moveStr)
    
    if (!isWhite) moveNumber++
    isWhite = !isWhite
  }
  
  return moves.join(" ")
}
