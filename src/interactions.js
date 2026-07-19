function makeSwipeable(card, onSwipe) {
  let startX = 0;
  let currentX = 0;
  let isDragging = false;
  const threshold = 100;

  card.addEventListener('mousedown', startDrag);
  card.addEventListener('touchstart', startDrag, { passive: true });

  // Reset/slide back on click anywhere on the container if revealed
  const parent = card.parentElement;
  if (parent) {
    parent.addEventListener('click', (e) => {
      if (card.classList.contains('revealed')) {
        e.stopPropagation();
        card.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        card.style.transform = 'translateX(0)';
        card.classList.remove('revealed');
      }
    });
  }

  function startDrag(e) {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a') || e.target.closest('[contenteditable="true"]')) return;
    
    startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    isDragging = true;
    card.style.transition = 'none';

    document.addEventListener('mousemove', drag);
    document.addEventListener('touchmove', drag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
  }

  function drag(e) {
    if (!isDragging) return;
    
    const x = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const diff = x - startX;
    currentX = diff;
    
    card.style.transform = `translateX(${currentX}px)`;
    
    if (Math.abs(diff) > 10 && e.cancelable) {
      e.preventDefault();
    }
  }

  function endDrag() {
    if (!isDragging) return;
    isDragging = false;

    document.removeEventListener('mousemove', drag);
    document.removeEventListener('touchmove', drag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchend', endDrag);

    card.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

    if (Math.abs(currentX) > threshold) {
      const direction = currentX > 0 ? 1 : -1;
      card.style.transform = `translateX(${direction * 100}%)`;
      card.classList.add('revealed');
      if (onSwipe) onSwipe(direction);
    } else {
      card.style.transform = 'translateX(0)';
      card.classList.remove('revealed');
    }
    
    currentX = 0;
  }
}

export { makeSwipeable };
