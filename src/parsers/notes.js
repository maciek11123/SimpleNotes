async function parseNotes(data) {
  try {
    const payload = data.payload || {};
    let insight = `### ${data.project} - ${data.intent}\n`;
    
    if (payload.summary) {
      insight += `> ${payload.summary}\n`;
    } else {
      insight += `> Memory memo archived.`;
    }

    return {
      type: 'NOTES',
      insight: insight.trim(),
      status: `📝 Note Archived (${data.project})`
    };
  } catch(e) {
    console.error("Notes parser error:", e);
    return {
      type: 'NOTES',
      insight: `Failed to archive note: ${e.message}`,
      status: '📝 Note Archived'
    };
  }
}

export { parseNotes };
