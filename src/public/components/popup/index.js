(() => {
    class Popup {
        constructor(name, triggers, content) {
            this.name = name;
            this.triggers = triggers;
            this.content = content;
            this.isOpen = false;

            this.content.setAttribute('role', 'dialog');
            this.content.setAttribute('aria-modal', 'false');
            this.content.setAttribute('tabindex', '-1');

            this.onTriggerClick = this.onTriggerClick.bind(this);
            this.onDocPointerDown = this.onDocPointerDown.bind(this);
            this.onKeyDown = this.onKeyDown.bind(this);
            this.onViewportChange = this.onViewportChange.bind(this);

            this.triggers.forEach((el) => {
                el.setAttribute('aria-haspopup', 'dialog');
                el.setAttribute('aria-expanded', 'false');
                el.addEventListener('click', this.onTriggerClick);
            });
        }

        open(anchorEl) {
            if (this.isOpen) return;
            this.isOpen = true;
            this.anchor = anchorEl || this.triggers[0];

            this.content.dataset.open = 'true';
            this.triggers.forEach((t) => t.setAttribute('aria-expanded', 'true'));
            this.positionNear(this.anchor);

            // NOTE: capture=true so we see events before inner handlers, but we use composedPath()
            document.addEventListener('pointerdown', this.onDocPointerDown, true);
            document.addEventListener('keydown', this.onKeyDown, true);

            // Reposition on viewport changes (don’t close)
            window.addEventListener('scroll', this.onViewportChange, { passive: true });
            window.addEventListener('resize', this.onViewportChange);
            this.rafReq = null;

            requestAnimationFrame(() => {
                const focusable = this.content.querySelector(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                (focusable || this.content).focus({ preventScroll: true });
            });
        }

        close() {
            if (!this.isOpen) return;
            this.isOpen = false;
            this.content.removeAttribute('data-open');
            this.triggers.forEach((t) => t.setAttribute('aria-expanded', 'false'));

            document.removeEventListener('pointerdown', this.onDocPointerDown, true);
            document.removeEventListener('keydown', this.onKeyDown, true);
            window.removeEventListener('scroll', this.onViewportChange);
            window.removeEventListener('resize', this.onViewportChange);
            if (this.rafReq) cancelAnimationFrame(this.rafReq);
        }

        toggle(anchorEl) {
            this.isOpen ? this.close() : this.open(anchorEl);
        }

        onTriggerClick(e) {
            e.stopPropagation();
            this.toggle(e.currentTarget);
        }

        onDocPointerDown(e) {
            // Robust inside test (works with scrollbars, shadow DOM)
            const path = e.composedPath ? e.composedPath() : [];
            const insideContent = path.includes(this.content) || this.content.contains(e.target);
            const insideTrigger = this.triggers.some((t) => path.includes(t) || t.contains(e.target));
            if (!insideContent && !insideTrigger) this.close();
        }

        onKeyDown(e) {
            if (e.key === 'Escape') this.close();
        }

        onViewportChange() {
            if (!this.isOpen) return;
            if (this.rafReq) return;
            this.rafReq = requestAnimationFrame(() => {
                this.rafReq = null;
                this.positionNear(this.anchor || this.triggers[0]);
            });
        }

        positionNear(triggerEl) {
            const rect = triggerEl.getBoundingClientRect();
            const panel = this.content;

            // Reveal temporarily to measure if needed
            const wasHidden = panel.style.display === 'none';
            if (wasHidden) panel.style.display = 'block';

            const panelWidth = Math.min(panel.offsetWidth || 300, window.innerWidth - 16);
            const panelHeight = panel.offsetHeight || 10;

            let top = rect.bottom + 8;
            let left = rect.left;

            if (left + panelWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - panelWidth - 8);

            if (top + panelHeight > window.innerHeight - 8) {
                const altTop = rect.top - panelHeight - 8;
                top = altTop > 8 ? altTop : Math.max(8, window.innerHeight - panelHeight - 8);
            }

            panel.style.left = `${Math.round(left)}px`;
            panel.style.top = `${Math.round(top)}px`;

            if (wasHidden) panel.style.display = '';
        }
    }

    const PopupManager = {
        instances: new Map(),
        init() {
            const triggerNodes = Array.from(document.querySelectorAll('[data-popup-trigger]'));
            const contentNodes = Array.from(document.querySelectorAll('[data-popup-content]'));
            const names = new Set([
                ...triggerNodes.map((n) => n.getAttribute('data-popup-trigger')),
                ...contentNodes.map((n) => n.getAttribute('data-popup-content')),
            ]);

            names.forEach((name) => {
                if (!name) return;
                const triggers = triggerNodes.filter((n) => n.getAttribute('data-popup-trigger') === name);
                const content = contentNodes.find((n) => n.getAttribute('data-popup-content') === name);
                if (!triggers.length || !content) return;

                content.style.display = 'none';
                const observer = new MutationObserver(() => {
                    const open = content.getAttribute('data-open') === 'true';
                    content.style.display = open ? 'block' : 'none';
                });
                observer.observe(content, { attributes: true, attributeFilter: ['data-open'] });

                const instance = new Popup(name, triggers, content);
                this.instances.set(name, instance);
            });

            // IMPORTANT: removed the old "close all on scroll" line.
            window.addEventListener('resize', () => this.closeAll());
            // If you want popups to persist across resize too, remove the line above.
        },
        closeAll() {
            this.instances.forEach((i) => i.close());
        },
    };

    // if (document.readyState === 'loading') {
    //     document.addEventListener('DOMContentLoaded', () => PopupManager.init());
    // } else {
    //     PopupManager.init();
    // }

    window.PopupManager = PopupManager;

    const boot = () => {
        PopupManager.init();

        // ✅ Close when the Electron window loses focus
        window.addEventListener('blur', () => PopupManager.closeAll());

        // ✅ Close when the page becomes hidden (window deactivated/minimized, etc.)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) PopupManager.closeAll();
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
