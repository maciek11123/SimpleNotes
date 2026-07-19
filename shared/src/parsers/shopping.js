async function parseShopping(data) {
  try {
    let output = '';
    const payload = data.payload || {};
    
    if (Array.isArray(payload.shopping_groups) && payload.shopping_groups.length > 0) {
      payload.shopping_groups.forEach(group => {
        output += `### ${group.store}\n`;
        if (Array.isArray(group.departments)) {
          group.departments.forEach(dept => {
            output += `**${dept.name}**:\n`;
            if (Array.isArray(dept.items)) {
              dept.items.forEach(item => {
                output += `- [ ] ${item}\n`;
              });
            }
          });
        }
        output += `\n`;
      });
    } else {
      output = `No shopping items parsed.`;
    }

    output = output.trim();

    // Append to centralized Main List ledger in LocalStorage
    let mainList = [];
    try {
      mainList = JSON.parse(localStorage.getItem('dotmemo-main-list')) || [];
    } catch(e) {}
    mainList.push({ id: Date.now(), text: output, date: new Date().toLocaleString() });
    localStorage.setItem('dotmemo-main-list', JSON.stringify(mainList));

    return {
      type: 'SHOPPING',
      insight: output,
      status: `🛍 Added to Main List (${data.project})`
    };
  } catch(e) {
    console.error("Shopping parser error:", e);
    return {
      type: 'SHOPPING',
      insight: `Failed to parse shopping list: ${e.message}`,
      status: '❌ Parser Error'
    };
  }
}

export { parseShopping };
