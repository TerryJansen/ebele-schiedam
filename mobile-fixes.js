(() => {
  function initialiseMobileNavigation() {
    const navItem = document.querySelector('.nav-item-dd');
    const menu = navItem?.querySelector('.dd-menu');
    if (!navItem || !menu || navItem.querySelector('.dd-mobile-toggle')) return;

    if (!menu.id) menu.id = 'mobile-product-menu';
    menu.removeAttribute('role');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dd-mobile-toggle';
    toggle.setAttribute('aria-label', 'Productgroepen tonen');
    toggle.setAttribute('aria-controls', menu.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

    const setOpen = open => {
      navItem.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Productgroepen verbergen' : 'Productgroepen tonen');
    };

    toggle.addEventListener('click', () => setOpen(!navItem.classList.contains('open')));

    navItem.insertBefore(toggle, menu);

    document.querySelector('.burger')?.addEventListener('click', () => {
      if (!document.querySelector('.nav-links')?.classList.contains('open')) {
        setOpen(false);
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !navItem.classList.contains('open')) return;
      setOpen(false);
      toggle.focus();
    });
  }

  function initialisePopup({ id, delay, closeName }) {
    const popup = document.getElementById(id);
    if (!popup) return;

    const storageKey = `ebele-popup-seen:${id}`;
    let timer;
    let seen = false;
    try { seen = sessionStorage.getItem(storageKey) === '1'; } catch (_) {}

    const remember = () => {
      try { sessionStorage.setItem(storageKey, '1'); } catch (_) {}
    };
    const close = () => {
      clearTimeout(timer);
      popup.classList.remove('open');
      popup.setAttribute('aria-hidden', 'true');
      remember();
    };
    const open = () => {
      popup.classList.add('open');
      popup.setAttribute('aria-hidden', 'false');
      remember();
    };

    window[closeName] = close;
    popup.setAttribute('aria-hidden', 'true');
    if (!seen) timer = window.setTimeout(open, delay);

    document.addEventListener('pointerdown', event => {
      if (popup.classList.contains('open') && !popup.contains(event.target)) close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && popup.classList.contains('open')) close();
    });
  }

  function initialisePopups() {
    initialisePopup({ id: 'brochureOverlay', delay: 2500, closeName: 'closeBrochure' });
    initialisePopup({ id: 'afdichtingBrochureOverlay', delay: 2500, closeName: 'closeAfdichtingBrochure' });
    initialisePopup({ id: 'sdsHelpPopup', delay: 5000, closeName: 'closeSdsHelp' });
  }

  function initialise() {
    initialiseMobileNavigation();
    initialisePopups();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise);
  } else {
    initialise();
  }
})();
