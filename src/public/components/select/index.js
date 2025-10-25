(() => {
    class CustomSelect {
        constructor(select) {
            this.select = select;
            this.isMultiple = !!select.multiple;
            this.lastToggledIndex = null; // for Shift range
            this.build();
            this.syncFromSelect();
            this.attachEvents();
        }

        build() {
            // wrapper & move native select inside (kept for form compatibility)
            this.wrapper = document.createElement('div');
            this.wrapper.className = 'cs-wrap' + (this.isMultiple ? ' cs-multiple' : '');
            this.select.parentNode.insertBefore(this.wrapper, this.select);
            this.wrapper.appendChild(this.select);
            this.select.classList.add('cs-native-hidden');

            // button
            this.button = document.createElement('button');
            this.button.type = 'button';
            this.button.className = 'cs-button';
            this.button.setAttribute('aria-haspopup', 'listbox');
            this.button.setAttribute('aria-expanded', 'false');
            this.button.setAttribute('aria-label', this.select.getAttribute('aria-label') || 'Select');
            this.wrapper.appendChild(this.button);

            // listbox
            this.list = document.createElement('ul');
            this.list.className = 'cs-list';
            this.list.tabIndex = -1;
            this.list.setAttribute('role', 'listbox');
            if (this.isMultiple) this.list.setAttribute('aria-multiselectable', 'true');
            this.list.id = `cs-${Math.random().toString(36).slice(2)}`;
            this.button.setAttribute('aria-controls', this.list.id);
            this.wrapper.appendChild(this.list);

            // elements
            this.optionEls = [];
            this.selectAllEl = null;

            // "Select All" (only in multiple)
            if (this.isMultiple) {
                this.selectAllEl = document.createElement('li');
                this.selectAllEl.className = 'cs-option cs-select-all';
                this.selectAllEl.setAttribute('role', 'option');
                this.selectAllEl.dataset.value = '__all__';
                this.selectAllEl.textContent = 'Select All';
                this.list.appendChild(this.selectAllEl);
                this.selectAllEl.addEventListener('click', () => this.toggleSelectAll());
                this.selectAllEl.addEventListener('mousemove', () => this.highlightOnly(-1));
            }

            // build options
            Array.from(this.select.options).forEach((opt) => {
                const li = document.createElement('li');
                li.className = 'cs-option';
                li.setAttribute('role', 'option');
                li.dataset.value = opt.value;
                // li.textContent = opt.text;

                if (opt.dataset.img) {
                    const img = document.createElement('img');
                    img.classList.add('option-image');
                    img.src = opt.dataset.img;
                    img.alt = '';
                    li.appendChild(img);
                }

                li.appendChild(document.createTextNode(opt.text));

                if (opt.disabled) li.setAttribute('aria-disabled', 'true');
                this.list.appendChild(li);
                this.optionEls.push(li);
            });

            // roving focus: activeIndex is for REAL options (0..n-1). -1 means "Select All".
            this.activeIndex = Math.max(this.select.selectedIndex, 0);
            if (this.isMultiple && this.activeIndex < 0) this.activeIndex = 0;
        }

        // open/close/toggle
        open() {
            if (this.isOpen) return;
            this.isOpen = true;
            this.wrapper.classList.add('cs-open');
            this.button.setAttribute('aria-expanded', 'true');
            this.list.focus({ preventScroll: true });
            this.highlightOnly(this.isMultiple ? -1 : this.activeIndex); // start at top or selected
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

        // selection (single: set; multiple: toggle)
        selectIndex(idx, user = true, forceState = null) {
            const opt = this.select.options[idx];
            if (!opt || opt.disabled) return;

            if (this.isMultiple) {
                const next = forceState ?? !opt.selected;
                opt.selected = next;
                this.lastToggledIndex = idx;
            } else {
                this.select.selectedIndex = idx;
            }

            this.syncFromSelect();
            if (user) this.select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Select All toggle (multiple only)
        toggleSelectAll(forceState = null) {
            if (!this.isMultiple) return;
            const opts = Array.from(this.select.options).filter((o) => !o.disabled);
            const allSelected = opts.length > 0 && opts.every((o) => o.selected);
            const state = forceState !== null ? forceState : !allSelected;
            opts.forEach((o) => (o.selected = state));
            this.syncFromSelect();
            this.select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Shift + click range
        selectRange(toIdx, eventLike) {
            if (!this.isMultiple) return;
            const fromIdx = this.lastToggledIndex ?? this.activeIndex ?? toIdx;
            const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
            const targetState = !this.select.options[toIdx].selected;
            for (let i = start; i <= end; i++) {
                const opt = this.select.options[i];
                if (!opt || opt.disabled) continue;
                opt.selected = targetState;
            }
            this.lastToggledIndex = toIdx;
            this.syncFromSelect();
            this.select.dispatchEvent(new Event('change', { bubbles: true }));
            eventLike?.preventDefault?.();
        }

        // Ctrl/Cmd+A select all/clear
        selectAll(state) {
            if (!this.isMultiple) return;
            Array.from(this.select.options).forEach((o) => {
                if (!o.disabled) o.selected = state;
            });
            this.syncFromSelect();
            this.select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // sync UI from native select
        syncFromSelect() {
            const idx = this.select.selectedIndex;
            const selectedOpts = Array.from(this.select.selectedOptions || []).map((o) => o.text);

            // button text
            if (this.isMultiple) {
                if (selectedOpts.length === 0) this.button.textContent = 'Select';
                else if (selectedOpts.length <= 2) this.button.textContent = selectedOpts.join(', ');
                else this.button.textContent = `${selectedOpts.length} selected`;
            } else {
                // const text = idx >= 0 ? this.select.options[idx].text : this.select.options[0]?.text || 'Select';
                // this.button.textContent = text;

                this.button.innerHTML = '';
                const selectedOpt = this.isMultiple ? this.select.selectedOptions[0] : this.select.options[idx];

                if (selectedOpt?.dataset?.img) {
                    const img = document.createElement('img');
                    img.classList.add('option-image');
                    img.src = selectedOpt.dataset.img;
                    img.alt = '';
                    this.button.appendChild(img);
                }

                this.button.appendChild(
                    document.createTextNode(
                        this.isMultiple
                            ? selectedOpts.length === 0
                                ? 'Select'
                                : selectedOpts.length <= 2
                                  ? selectedOpts.join(', ')
                                  : `${selectedOpts.length} selected`
                            : selectedOpt?.text || 'Select'
                    )
                );
            }

            // option rows
            this.optionEls.forEach((li, i) => {
                const opt = this.select.options[i];
                const isSelected = !!opt.selected;
                if (isSelected) {
                    li.classList.add('cs-selected');
                    li.setAttribute('aria-selected', 'true');
                    if (!this.isMultiple) this.activeIndex = i;
                } else {
                    li.classList.remove('cs-selected');
                    li.removeAttribute('aria-selected');
                }
            });

            // select-all row visual state
            if (this.selectAllEl) {
                const opts = Array.from(this.select.options).filter((o) => !o.disabled);
                const allSelected = opts.length > 0 && opts.every((o) => o.selected);
                this.selectAllEl.classList.toggle('cs-selected', allSelected);
                if (allSelected) this.selectAllEl.setAttribute('aria-selected', 'true');
                else this.selectAllEl.removeAttribute('aria-selected');
            }
        }

        // keyboard roving focus (supports Select All at index -1)
        moveActive(delta) {
            const total = this.optionEls.length + (this.isMultiple ? 1 : 0);
            // map current to combined position
            let cur = this.isMultiple ? (this.activeIndex === -1 ? 0 : this.activeIndex + 1) : this.activeIndex;
            // iterate
            for (let step = 0; step < total; step++) {
                cur = (cur + delta + total) % total;
                // map back
                if (this.isMultiple && cur === 0) {
                    // Select All is never disabled
                    this.activeIndex = -1;
                    this.highlightOnly(-1);
                    this.scrollActiveIntoView();
                    return;
                }
                const realIdx = this.isMultiple ? cur - 1 : cur;
                const opt = this.select.options[realIdx];
                if (opt && !opt.disabled) {
                    this.activeIndex = realIdx;
                    this.highlightOnly(realIdx);
                    this.scrollActiveIntoView();
                    return;
                }
            }
        }

        highlightOnly(i) {
            // i = -1 means "Select All"
            this.optionEls.forEach((li, idx) => li.classList.toggle('cs-active', idx === i));
            if (this.selectAllEl) this.selectAllEl.classList.toggle('cs-active', i === -1);
        }

        scrollActiveIntoView() {
            if (!this.isOpen) return;
            const p = this.list;
            if (this.activeIndex === -1 && this.selectAllEl) {
                p.scrollTop = 0;
                return;
            }
            const active = this.optionEls[this.activeIndex];
            if (!active) return;
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

            // option click handlers
            this.optionEls.forEach((li, i) => {
                li.addEventListener('click', (e) => {
                    if (this.select.options[i].disabled) return;
                    if (this.isMultiple) {
                        if (e.shiftKey) this.selectRange(i, e);
                        else this.selectIndex(i, true);
                        // keep open in multiple
                    } else {
                        this.selectIndex(i);
                        this.close();
                    }
                });
                li.addEventListener('mousemove', () => {
                    if (this.activeIndex !== i) {
                        this.activeIndex = i;
                        this.highlightOnly(i);
                    }
                });
            });

            // keyboard on button
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

            // keyboard on list
            this.list.addEventListener('keydown', (e) => {
                // Ctrl/Cmd + A (multiple)
                if (this.isMultiple && e.key.toLowerCase?.() === 'a' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    const opts = Array.from(this.select.options).filter((o) => !o.disabled);
                    const allSelected = opts.length > 0 && opts.every((o) => o.selected);
                    this.selectAll(!allSelected);
                    return;
                }

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
                        this.highlightOnly(this.isMultiple ? -1 : 0);
                        this.activeIndex = this.isMultiple ? -1 : 0;
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
                        if (this.isMultiple) {
                            if (this.activeIndex === -1)
                                this.toggleSelectAll(); // "Select All"
                            else this.selectIndex(this.activeIndex, true);
                        } else {
                            this.selectIndex(this.activeIndex);
                            this.close();
                        }
                        break;
                    case 'Escape':
                    case 'Tab':
                        this.close();
                        break;
                    default:
                        // typeahead (single letter)
                        if (e.key.length === 1 && /\S/.test(e.key)) {
                            const key = e.key.toLowerCase();
                            const start = (this.activeIndex ?? -1) + 1;
                            const opts = Array.from(this.select.options);
                            const find = (from) => {
                                for (let i = from; i < opts.length; i++) {
                                    if (!opts[i].disabled && opts[i].text.toLowerCase().startsWith(key)) return i;
                                }
                                return -1;
                            };
                            let idx = find(start);
                            if (idx === -1) idx = find(0);
                            if (idx !== -1) {
                                this.activeIndex = idx;
                                this.highlightOnly(idx);
                                this.scrollActiveIntoView();
                            }
                        }
                }
            });

            // keep in sync if value changes programmatically
            this.select.addEventListener('change', () => this.syncFromSelect());

            // react to dynamic <option> changes and toggling [multiple]
            const mo = new MutationObserver(() => this.rebuildOptions());
            mo.observe(this.select, { childList: true, subtree: true, attributes: true });
            this.mutationObserver = mo;
        }

        rebuildOptions() {
            // re-detect multiple & aria
            this.isMultiple = !!this.select.multiple;
            this.wrapper.classList.toggle('cs-multiple', this.isMultiple);
            if (this.isMultiple) this.list.setAttribute('aria-multiselectable', 'true');
            else this.list.removeAttribute('aria-multiselectable');

            // clear list
            this.list.innerHTML = '';
            this.optionEls = [];
            this.selectAllEl = null;

            // rebuild select-all if needed
            if (this.isMultiple) {
                this.selectAllEl = document.createElement('li');
                this.selectAllEl.className = 'cs-option cs-select-all';
                this.selectAllEl.setAttribute('role', 'option');
                this.selectAllEl.dataset.value = '__all__';
                this.selectAllEl.textContent = 'Select All';
                this.list.appendChild(this.selectAllEl);
                this.selectAllEl.addEventListener('click', () => this.toggleSelectAll());
                this.selectAllEl.addEventListener('mousemove', () => this.highlightOnly(-1));
            }

            // rebuild options
            Array.from(this.select.options).forEach((opt, i) => {
                const li = document.createElement('li');
                li.className = 'cs-option';
                li.setAttribute('role', 'option');
                li.dataset.value = opt.value;
                li.textContent = opt.text;
                if (opt.disabled) li.setAttribute('aria-disabled', 'true');
                this.list.appendChild(li);
                this.optionEls.push(li);

                li.addEventListener('click', (e) => {
                    if (opt.disabled) return;
                    if (this.isMultiple) {
                        if (e.shiftKey) this.selectRange(i, e);
                        else this.selectIndex(i, true);
                    } else {
                        this.select.value = opt.value;
                        this.syncFromSelect();
                        this.select.dispatchEvent(new Event('change', { bubbles: true }));
                        this.close();
                    }
                });

                li.addEventListener('mousemove', () => {
                    if (this.activeIndex !== i) {
                        this.activeIndex = i;
                        this.highlightOnly(i);
                    }
                });
            });

            // reset active index reasonably
            this.activeIndex = this.isMultiple ? -1 : Math.max(this.select.selectedIndex, 0);
            this.syncFromSelect();
        }
    }

    // Initialize all current & future selects with data-select-custom
    const init = (root = document) => {
        root.querySelectorAll('select[data-select-custom]:not(.cs-initialized)').forEach((sel) => {
            sel.classList.add('cs-initialized');
            const selectDOM = new CustomSelect(sel);

            // NEW: Close on Electron window blur / page hidden (Option A)
            window.addEventListener('blur', () => selectDOM.close());
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) selectDOM.close();
            });
        });
    };
    init();

    // Auto-init for dynamically added elements
    const moRoot = new MutationObserver((muts) => {
        for (const m of muts) {
            if (!m.addedNodes) continue;
            m.addedNodes.forEach((n) => {
                if (n.nodeType !== 1) return;
                if (n.matches?.('select[data-select-custom]')) init(n.parentNode || document);
                else if (n.querySelectorAll) init(n);
            });
        }
    });
    moRoot.observe(document.documentElement, { childList: true, subtree: true });
})();
