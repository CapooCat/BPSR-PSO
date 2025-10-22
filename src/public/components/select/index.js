(() => {
    class CustomSelect {
        constructor(select) {
            this.select = select;
            this.build();
            this.syncFromSelect();
            this.attachEvents();
        }

        build() {
            // Wrapper
            this.wrapper = document.createElement('div');
            this.wrapper.className = 'cs-wrap';
            this.select.parentNode.insertBefore(this.wrapper, this.select);
            this.wrapper.appendChild(this.select);

            // Hide native select (but keep in DOM for forms/JS)
            this.select.classList.add('cs-native-hidden');

            // Button (display)
            this.button = document.createElement('button');
            this.button.type = 'button';
            this.button.className = 'cs-button';
            this.button.setAttribute('aria-haspopup', 'listbox');
            this.button.setAttribute('aria-expanded', 'false');
            this.button.setAttribute('aria-label', this.select.getAttribute('aria-label') || 'Select');
            this.wrapper.appendChild(this.button);

            // Listbox
            this.list = document.createElement('ul');
            this.list.className = 'cs-list';
            this.list.tabIndex = -1;
            this.list.setAttribute('role', 'listbox');
            this.list.id = `cs-${Math.random().toString(36).slice(2)}`;
            this.button.setAttribute('aria-controls', this.list.id);
            this.wrapper.appendChild(this.list);

            // Options
            this.optionEls = [];
            Array.from(this.select.options).forEach((opt, i) => {
                const li = document.createElement('li');
                li.className = 'cs-option';
                li.setAttribute('role', 'option');
                li.dataset.value = opt.value;
                li.textContent = opt.text;
                if (opt.disabled) li.setAttribute('aria-disabled', 'true');
                this.list.appendChild(li);
                this.optionEls.push(li);
            });

            // For roving focus
            this.activeIndex = Math.max(this.select.selectedIndex, 0);
        }

        open() {
            if (this.isOpen) return;
            this.isOpen = true;
            this.wrapper.classList.add('cs-open');
            this.button.setAttribute('aria-expanded', 'true');
            this.list.focus({ preventScroll: true });
            this.scrollActiveIntoView();
            document.addEventListener('click', this.onDocClick, { capture: true });
        }

        close() {
            if (!this.isOpen) return;
            this.isOpen = false;
            this.wrapper.classList.remove('cs-open');
            this.button.setAttribute('aria-expanded', 'false');
            this.button.focus({ preventScroll: true });
            document.removeEventListener('click', this.onDocClick, { capture: true });
        }

        toggle() {
            this.isOpen ? this.close() : this.open();
        }

        selectIndex(idx, user = true) {
            const opt = this.select.options[idx];
            if (!opt || opt.disabled) return;

            this.select.selectedIndex = idx;
            this.syncFromSelect();
            if (user) this.select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        syncFromSelect() {
            const idx = this.select.selectedIndex;
            const text = idx >= 0 ? this.select.options[idx].text : this.select.options[0]?.text || 'Select';
            this.button.textContent = text;

            this.optionEls.forEach((li, i) => {
                if (i === idx) {
                    li.classList.add('cs-selected');
                    li.setAttribute('aria-selected', 'true');
                    this.activeIndex = i;
                } else {
                    li.classList.remove('cs-selected');
                    li.removeAttribute('aria-selected');
                }
            });
        }

        moveActive(delta) {
            let i = this.activeIndex ?? 0;
            const len = this.optionEls.length;
            for (let step = 0; step < len; step++) {
                i = (i + delta + len) % len;
                const opt = this.select.options[i];
                if (opt && !opt.disabled) {
                    this.activeIndex = i;
                    this.highlightOnly(i);
                    this.scrollActiveIntoView();
                    break;
                }
            }
        }

        highlightOnly(i) {
            this.optionEls.forEach((li, idx) => {
                li.classList.toggle('cs-active', idx === i);
            });
        }

        scrollActiveIntoView() {
            const active = this.optionEls[this.activeIndex];
            if (!active) return;
            const p = this.list;
            const aTop = active.offsetTop,
                aBot = aTop + active.offsetHeight;
            if (aTop < p.scrollTop) p.scrollTop = aTop;
            else if (aBot > p.scrollTop + p.clientHeight) p.scrollTop = aBot - p.clientHeight;
        }

        attachEvents() {
            this.onDocClick = (e) => {
                if (!this.wrapper.contains(e.target)) this.close();
            };

            this.button.addEventListener('click', () => this.toggle());

            // Click on options
            this.optionEls.forEach((li, i) => {
                li.addEventListener('click', () => {
                    if (this.select.options[i].disabled) return;
                    this.selectIndex(i);
                    this.close();
                });
                // Hover move highlight (nice UX)
                li.addEventListener('mousemove', () => {
                    if (this.activeIndex !== i) {
                        this.activeIndex = i;
                        this.highlightOnly(i);
                    }
                });
            });

            // Keyboard: button
            this.button.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case 'ArrowDown':
                    case 'ArrowUp':
                    case ' ':
                    case 'Enter':
                        e.preventDefault();
                        this.open();
                        break;
                }
            });

            // Keyboard: list
            this.list.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        this.moveActive(1);
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        this.moveActive(-1);
                        break;
                    case 'Home':
                        e.preventDefault();
                        this.activeIndex = 0;
                        this.highlightOnly(0);
                        this.scrollActiveIntoView();
                        break;
                    case 'End':
                        e.preventDefault();
                        this.activeIndex = this.optionEls.length - 1;
                        this.highlightOnly(this.activeIndex);
                        this.scrollActiveIntoView();
                        break;
                    case 'Enter':
                    case ' ':
                        e.preventDefault();
                        this.selectIndex(this.activeIndex);
                        this.close();
                        break;
                    case 'Escape':
                    case 'Tab':
                        this.close();
                        break;
                }
            });

            // Keep in sync if someone sets select.value programmatically
            this.select.addEventListener('change', () => this.syncFromSelect());
            // If options change dynamically
            const mo = new MutationObserver(() => this.rebuildOptions());
            mo.observe(this.select, { childList: true, subtree: true, attributes: true });
            this.mutationObserver = mo;
        }

        rebuildOptions() {
            // Clear and rebuild options list
            this.list.innerHTML = '';
            this.optionEls = [];
            Array.from(this.select.options).forEach((opt) => {
                const li = document.createElement('li');
                li.className = 'cs-option';
                li.setAttribute('role', 'option');
                li.dataset.value = opt.value;
                li.textContent = opt.text;
                if (opt.disabled) li.setAttribute('aria-disabled', 'true');
                this.list.appendChild(li);
                this.optionEls.push(li);
                li.addEventListener('click', () => {
                    if (opt.disabled) return;
                    this.select.value = opt.value;
                    this.syncFromSelect();
                    this.select.dispatchEvent(new Event('change', { bubbles: true }));
                    this.close();
                });
                li.addEventListener('mousemove', () => {
                    const i = Array.from(this.select.options).indexOf(opt);
                    if (this.activeIndex !== i) {
                        this.activeIndex = i;
                        this.highlightOnly(i);
                    }
                });
            });
            this.syncFromSelect();
        }
    }

    // Initialize all current & future selects with data-select-custom
    const init = (root = document) => {
        root.querySelectorAll('select[data-select-custom]:not(.cs-initialized)').forEach((sel) => {
            sel.classList.add('cs-initialized');
            new CustomSelect(sel);
        });
    };
    init();

    // Auto-init for dynamically added elements
    const moRoot = new MutationObserver((muts) => {
        for (const m of muts) {
            m.addedNodes &&
                m.addedNodes.forEach((n) => {
                    if (n.nodeType === 1) {
                        if (n.matches?.('select[data-select-custom]')) init(n.parentNode || document);
                        else if (n.querySelectorAll) init(n);
                    }
                });
        }
    });
    moRoot.observe(document.documentElement, { childList: true, subtree: true });
})();
