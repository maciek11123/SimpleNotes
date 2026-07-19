async function parseGames(data) {
  try {
    const payload = data.payload || {};
    let formatted = `### ${data.project} - ${data.intent}\n`;
    
    if (payload.summary) {
      formatted += `> ${payload.summary}\n\n`;
    }
    
    if (Array.isArray(payload.technical_expansions) && payload.technical_expansions.length > 0) {
      formatted += `#### Technical Expansions:\n`;
      payload.technical_expansions.forEach(exp => {
        formatted += `- ${exp}\n`;
      });
      formatted += `\n`;
    }
    
    if (Array.isArray(payload.problem_solutions) && payload.problem_solutions.length > 0) {
      formatted += `#### Problem Solutions:\n`;
      payload.problem_solutions.forEach(sol => {
        formatted += `- ${sol}\n`;
      });
      formatted += `\n`;
    }
    
    if (payload.version_control && payload.version_control.suggested_branch) {
      formatted += `#### 🛠 Version Control & Sandboxing:\n`;
      formatted += `* **Branch:** \`${payload.version_control.suggested_branch}\`\n`;
      formatted += `* **Folder:** \`${payload.version_control.target_folder_path}\`\n`;
      formatted += `* **Rationale:** ${payload.version_control.isolation_rationale}\n`;
    }

    return {
      type: data.intent,
      insight: formatted.trim(),
      status: `⚙ Processed (${data.project})`
    };
  } catch(e) {
    console.error("Games/Solutions parser error:", e);
    return {
      type: data.intent || 'GAME_IDEA',
      insight: `Failed to compile concepts: ${e.message}`,
      status: '❌ Parser Error'
    };
  }
}

export { parseGames };
