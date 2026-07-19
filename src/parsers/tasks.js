async function parseTasks(data) {
  try {
    const payload = data.payload || {};
    let insight = `### ${data.project} - ${data.intent}\n`;
    let status = data.intent === 'CALENDAR' ? '📅 Scheduled' : '📋 Tasks Extracted';

    if (payload.calendar_formatted) {
      insight += `**Schedule**: ${payload.calendar_formatted}\n\n`;

      // Extract details if possible to add to pixel-keep-reminders list
      // Calendar format example: "📅 Event: [Name] | Who: [Person/Entity] | When: [Date/Time]"
      const matchName = payload.calendar_formatted.match(/Event:\s*([^|]+)/);
      const matchWhen = payload.calendar_formatted.match(/When:\s*([^|]+)/);
      
      const title = matchName ? matchName[1].trim() : 'Scheduled Event';
      const dateVal = matchWhen ? matchWhen[1].trim() : new Date().toISOString();

      let reminders = [];
      try {
        reminders = JSON.parse(localStorage.getItem('pixel-keep-reminders')) || [];
      } catch(e) {}
      
      reminders.push({
        id: Date.now() + Math.random(),
        text: `${title} (${data.project})`,
        time: dateVal,
        triggered: false
      });
      localStorage.setItem('pixel-keep-reminders', JSON.stringify(reminders));
      status = '[📅 Added to Calendar]';
    }

    if (Array.isArray(payload.actionable_tasks) && payload.actionable_tasks.length > 0) {
      insight += `#### Action Checklist:\n`;
      payload.actionable_tasks.forEach(task => {
        insight += `- [ ] ${task}\n`;
      });
    }

    return {
      type: data.intent,
      insight: insight.trim(),
      status: status
    };
  } catch(e) {
    console.error("Tasks parser error:", e);
    return {
      type: 'TASKS',
      insight: `Failed to parse tasks: ${e.message}`,
      status: '❌ Parser Error'
    };
  }
}

export { parseTasks };
