const {
  Plugin,
  Editor,
  ItemView,
  Menu,
  Notice,
  MarkdownRenderChild,
  MarkdownRenderer,
  requestUrl,
  PluginSettingTab,
  Setting,
} = require('obsidian');

const DEFAULT_SETTINGS = {
  verseTemplate: '{title}\u2002“*{text}*”', // non-breaking space
  verseCalloutTemplate: '> [!verse] BIBLE — {title}\n> {text}\n',
  pubTemplate: '{title}\n“*{text}*”',
  pubCalloutTemplate: '> [!cite] PUB. — {title}\n> {text}\n',
  historySize: 20,
  boldInitialNum: true,
  citationLink: true,
  spaceAfterPunct: true,
  paraCount: 1,
  lang: 'English',
};

// Keep separate from OutputError to allow future i18n
const Lang = {
  name: 'JWL Linker',
  noMatch: '⚠️ No match. This is not a scripture reference.',
  invalidScripture: '⚠️ This is not a valid scripture reference.',
  invalidUrl: '⚠️ This is not a valid wol.jw.org url.',
  onlineLookupFailed: '⚠️ Online scripture lookup failed. Try again.',
  loadingCitation: '⏳ Loading citation:',
  noEditor: '⚠️ No active editor available.',
  noSelection: '⚠️ Nothing on cursor line or no selection.',
  copiedHistoryMsg: 'History item copied to clipboard',
  noHistoryYet: 'No history to display.',
  noTitle: 'Title missing',
  helpIntro: 'This sidebar shows all the recent verses, paragraphs, and publications you have cited using the plugin.',
  helpCopy: 'Click any item above to copy it to the clipboard.',
  helpClear: 'Click here to clear the search history.',
  hideTip: 'Click to hide',
  help: 'Help',
  emptyPara: '*⟪ Empty paragraph ⟫*',
  /** @type {Object<string, string>} value: display text*/
  paragraphOptions: {
    1: '1',
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
  },
  /** @type {Object<string, string>} value: display text*/
  historySize: {
    0: '0',
    10: 10,
    20: 20,
    30: 30,
    40: 40,
    50: 50,
    75: 75,
    100: 100,
  },
};

const Languages = {
  English: 'EN',
  German: 'DE',
  Dutch: 'NL',
  French: 'FR',
};

const Config = {
  jwlFinder: 'jwlibrary:///finder?',
  jwlLocale: '&wtlocale=E', // English only right now
  wolRoot: 'https://wol.jw.org/en/wol/d/', // d = direct
  wolPublications: 'https://wol.jw.org/en/wol/d/r1/lp-e/',
  wolLookup: 'https://wol.jw.org/en/wol/l/r1/lp-e?q=', // l = lookup
  webFinder: 'https://www.jw.org/finder?',
  urlParam: 'bible=',
  // [1] whole scripture match [2] plain text [3] book name [4] chapter/verse passages [5] already link
  scriptureRegex:
    /(('?)((?:[123][\u0020\u00A0]?)?(?:[\p{L}\p{M}\.]{2,}|song of solomon))((?: ?(?:\d{1,3}):(?:\d{1,3})(?:[-,] ?\d{1,3})*;?)+))(\]|<\/a>)?/gimu,
  scriptureNoChpRegex: /(('?)(obadiah|ob|phm|philemon|(?:2|3)(?: )?jo(?:hn)?|jud(?:e)?)(?: ?)(\d{1,2}))(\]|<\/a>)?/gim,
  wolLinkRegex: /(\[([^\[\]]*)\]\()?(https\:\/\/wol\.jw\.org[^\s\)]{2,})(\))?/gim,
  jworgLinkRegex: /(\[([^\[\]]*)\]\()?(https[^\s\)]+jw\.org[^\s\)]{2,})(\))?/gim,
  initialNumRegex: /^([\n\s]?)(\d{1,3}) /gim,
  delay: 3000,
};

// All the available commands provided by the plugin
const Cmd = {
  citeVerse: 'citeVerse',
  citeVerseCallout: 'citeVerseCallout',
  citeParagraph: 'citeParagraph',
  citeParagraphCallout: 'citeParagraphCallout',
  citePublicationLookup: 'citePublicationLookup',
  addLinkTitle: 'addLinkTitle',
  convertScriptureToJWLibrary: 'convertScriptureToJWLibrary',
  convertWebToJWLibrary: 'convertWebToJWLibrary',
  openScriptureInJWLibrary: 'openScriptureInJWLibrary',
};

const JWL_LINKER_VIEW = 'jwl-linker-view';

class JWLLinkerPlugin extends Plugin {
  constructor() {
    //// biome-ignore lint/style/noArguments:
    super(...arguments);
    /** @type {Object} */
    this.settings = {};
    /** @type {Menu} */
    this.menu = new Menu();
    this.menuClass = 'jwl-linker-plugin-menu-container';
  }

  async onload() {
    await this.loadSettings();

    /** @namespace */
    this.api = {
      getAllScriptureLinks: this._getAllScriptureLinks,
      DisplayType: DisplayType,
    };

    // Load command palette
    for (const cmd of this.MenuCommands) {
      this.addCommand({
        id: cmd.id,
        name: cmd.text,
        icon: cmd.icon,
        editorCallback: cmd.fn,
      });
    }

    // Cache the populated menu
    this.menu = this.buildMenu();

    // Add the global Open JWL Menu command (for Mobile toolbar)
    this.addCommand({
      id: this.MenuName.id,
      name: this.MenuName.text,
      icon: this.MenuName.icon,
      editorCallback: (editor) => this.showMenu(editor),
    });

    this.addCommand({
      id: 'jwl-linker-open',
      name: 'Open sidebar',
      callback: this.activateView.bind(this),
    });

    // Add right-click submenu item in Editor (for Desktop)
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        menu.addItem((item) => {
          item.setTitle(this.MenuName.text).setIcon(this.MenuName.icon);
          const submenu = item.setSubmenu();
          this.buildMenu(submenu);
        });
      }),
    );

    this.registerView(JWL_LINKER_VIEW, (leaf) => new JWLLinkerView(leaf, this.settings));

    // KEY FEATURE
    // In READING Mode: Render scriptures as JWLibrary links
    this.registerMarkdownPostProcessor((element, context) => {
      context.addChild(new ScripturePostProcessor(element, this));
    });

    this.app.workspace.onLayoutReady(this.activateView.bind(this));

    this.addSettingTab(new JWLLinkerSettingTab(this.app, this));

    // biome-ignore lint: ⚠️
    console.log(
      `%c${this.manifest.name} ${this.manifest.version} loaded`,
      'background-color: purple; padding:4px; border-radius:4px',
    );
  }

  onunload() { }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(JWL_LINKER_VIEW).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false); // false => no split
      await leaf.setViewState({
        type: JWL_LINKER_VIEW,
        active: true,
      });
      await workspace.revealLeaf(leaf);
    }
  }

  /**
   * KEY FEATURE
   * Convert input to JW Library links,
   * Search entire input string for ...
   *   1. plain text scripture references
   *   2. jw.org Finder links | wol.jw.org links
   * Both are validated and return an error Notice on failure
   * Editing/Preview View only
   * @param {Editor} editor
   * @param {Cmd} command
   */
  linkToJWLibrary(editor, command) {
    const activeEditor = this.confirmEditor(editor);
    if (!activeEditor) return;
    const { selection } = this._getEditorSelection(activeEditor);
    if (selection) {
      let output;
      let changed;
      if (command === Cmd.convertScriptureToJWLibrary) {
        ({ output, changed } = this._convertScriptureToJWLibrary(selection, DisplayType.md));
      } else if (command === Cmd.convertWebToJWLibrary) {
        ({ output, changed } = this._convertWebToJWLibrary(selection));
      }
      if (changed) {
        activeEditor.replaceSelection(output);
      }
    } else {
      new Notice(Lang.noSelection, Config.delay);
    }
  }

  /**
   * Open the scripture under the caret in JWLibrary
   * Only in Editing/Preview mode
   * @param {Editor} editor 
   */
  openInJWLibrary(editor) {
    const activeEditor = this.confirmEditor(editor);
    if (!activeEditor) return;
    const { selection, caret } = this._getEditorSelection(activeEditor, false);
    if (selection) {
      const { output, changed } = this._convertScriptureToJWLibrary(selection, DisplayType.url, caret);
      if (changed) {
        window.open(output);
      }
    } else {
      new Notice(Lang.noSelection, Config.delay);
    }
  }

  /**
   * KEY FEATURE
   * Editing/Preview View only:
   * Cite publication lookup reference, returns all pages in the reference, below
   * Cite scripture reference in full below or just a snippet inline, adds a JWL link
   * Cite paragraph or snippet from JW.Org Finder or WOL url,
   *    with correct publication navigation title
   * Add title only: an MD link with correct navigation title + url
   * @param {Editor} editor
   * @param {Cmd} command
   * @param {number} [pars] *Number of paragraphs to cite (Use 0 for link only)
   */
  async insertCitation(editor, command, pars = 0) {
    /** @type {Notice} */
    let loadingNotice;
    const activeEditor = this.confirmEditor(editor);
    if (!activeEditor) return;
    let { selection, caret, line } = this._getEditorSelection(activeEditor);
    if (selection) {
      selection = selection.trim();
      loadingNotice = new Notice(`${Lang.loadingCitation} ${selection}`); // remain open until we complete
      const view = await this.getView();
      switch (command) {
        case Cmd.citeVerse:
        case Cmd.citeVerseCallout:
          // Convert Scripture reference into bible verse citation (+ JW Library MD URL*)
          this._fetchBibleCitation(selection, view, caret, command).then(replaceEditorSelection);
          break;
        case Cmd.citeParagraph:
        case Cmd.citeParagraphCallout:
        case Cmd.addLinkTitle:
          // Convert JW.Org Finder-type URL to a paragraph citation (+ JW Library MD URL*)
          this._fetchParagraphCitation(selection, view, caret, command, pars).then(replaceEditorSelection);
          break;
        case Cmd.citePublicationLookup:
          // Convert Publication lookup into a article citation
          this._fetchLookupCitation(selection, view).then(replaceEditorSelection);
          break;
      }
    } else {
      new Notice(Lang.noSelection, Config.delay);
    }

    function replaceEditorSelection(output) {
      // Any errors will be part of the result
      activeEditor.replaceSelection(output);
      // try to select the original reference, first line (helps user delete it quickly if needed)
      const last = activeEditor.getLine(line).length;
      activeEditor.setSelection({ line: line, ch: 0 }, { line: line, ch: last });
      loadingNotice.hide();
    }
  }

  /**
   * Check if there is an active editor, and attempt to return it
   * @param {Editor} editor
   * @returns {Editor}
   */
  confirmEditor(editor) {
    let activeEditor = editor;
    if (!activeEditor?.hasFocus()) {
      const view = this.app.workspace.getMostRecentLeaf().view;
      if (view) {
        activeEditor = view.editor;
      }
    }
    if (!activeEditor) {
      new Notice(Lang.noEditor, Config.delay);
    }
    return activeEditor;
  }

  /**
   * Get a valid view reference even if deferred, so that we can add to the history
   * Does not reveal the leaf as the user might be using a different one
   * @returns {View|null}
   */
  async getView() {
    const leaf = this.app.workspace.getLeavesOfType(JWL_LINKER_VIEW).first();
    if (leaf) {
      await leaf.loadIfDeferred(); // don't reveal in case user has another sidebar open
      if (leaf && leaf.view instanceof JWLLinkerView) {
        return leaf.view;
      }
    }
    return null;
  }

  /**
   * Show the dropdown menu just below the caret
   * @param {Editor} editor
   * @param {Menu} menu
   * @returns {void}
   */
  showMenu(editor) {
    // Is the menu already active?
    if (document.querySelector(`.menu${this.menuClass}`)) return;

    if (!editor || !editor.hasFocus()) {
      new Notice(Lang.noEditor, Config.delay);
      return;
    }
    const cursor = editor.getCursor('from');
    const offset = editor.posToOffset(cursor);
    const coords = editor.cm.coordsAtPos(offset);
    this.menu.showAtPosition({
      x: coords.right,
      y: coords.top + 20,
    });
  }

  /**
   * Prepare the dropdown menu. Each menu item calls its command counterpart
   * @param {*} submenu submenu instance of a parent menu; if empty create new menu
   * @returns New menu ready to use
   */
  buildMenu(submenu = undefined) {
    /** @type {Menu} */
    const menu = submenu ? submenu : new Menu();
    // this class is needed to identify if the menu is already open
    menu.dom.addClass(this.menuClass);
    // no title on submenus
    if (!submenu) {
      menu.addItem((item) => {
        item.setTitle(this.MenuName.title);
        item.setIcon(this.MenuName.icon);
        item.setIsLabel(true);
      });
      menu.addSeparator();
    }
    for (const cmd of this.MenuCommands) {
      menu.addItem((item) => {
        item.setTitle(cmd.text);
        item.setIcon(cmd.icon);
        item.onClick(() => this.app.commands.executeCommandById(`${this.manifest.id}:${cmd.id}`));
      });
      if (cmd.sep ?? null) menu.addSeparator();
    }
    // Select no. of paragraphs to cite
    menu.addItem((item) => {
      const titleEl = createDiv({ text: this.MenuParaCount.text });
      titleEl.createSpan({ text: this.settings.paraCount });
      item.setTitle(titleEl);
      item.setIcon(this.MenuParaCount.icon);
      const submenu = item.setSubmenu();
      for (const [key, value] of Object.entries(Lang.paragraphOptions)) {
        submenu.addItem((item) => {
          item.setTitle(value);
          item.setIcon('pilcrow');
          item.setChecked(Number(key) === this.settings.paraCount);
          item.onClick(() => {
            this.settings.paraCount = Number(value);
            this.saveSettings();
            // TODO keep menu open (complicated...)
          });
        });
      }
    });
    // Toggle citation link on/off
    menu.addItem((item) => {
      item.setTitle(this.MenuCitationLink.text);
      item.setIcon(this.MenuCitationLink.icon);
      item.setChecked(this.settings.citationLink);
      item.onClick(() => {
        this.settings.citationLink = !this.settings.citationLink;
        this.saveSettings();
      });
    });
    return menu;
  }

  MenuName = {
    id: 'openJWLLinkerMenu',
    text: 'JWL Linker',
    title: 'JWL Linker',
    icon: 'gem',
  };

  MenuCommands = [
    {
      id: Cmd.citeVerse,
      text: 'Cite verses',
      icon: 'whole-word',
      fn: (editor) => this.insertCitation(editor, Cmd.citeVerse),
    },
    {
      id: Cmd.citeVerseCallout,
      text: 'Cite verses as callout',
      icon: 'book-open',
      fn: (editor) => this.insertCitation(editor, Cmd.citeVerseCallout),
      sep: true,
    },
    {
      id: Cmd.citeParagraph,
      text: 'Cite jw.org url',
      icon: 'whole-word',
      fn: (editor) => this.insertCitation(editor, Cmd.citeParagraph, 1),
    },
    {
      id: `${Cmd.citeParagraphCallout}`,
      text: 'Cite jw.org url as callout',
      icon: 'lucide-panel-top-open',
      fn: (editor) => this.insertCitation(editor, Cmd.citeParagraphCallout, 1),
      sep: true,
    },
    {
      id: Cmd.citePublicationLookup,
      text: 'Cite publication lookup',
      icon: 'reading-glasses',
      fn: (editor) => this.insertCitation(editor, Cmd.citePublicationLookup),
      sep: true,
    },
    {
      id: Cmd.addLinkTitle,
      text: 'Add title to jw.org url',
      icon: 'link',
      fn: (editor) => this.insertCitation(editor, Cmd.addLinkTitle),
    },
    {
      id: Cmd.convertScriptureToJWLibrary,
      text: 'Convert scriptures to JW Library',
      icon: 'library',
      fn: (editor) => this.linkToJWLibrary(editor, Cmd.convertScriptureToJWLibrary),
    },
    {
      id: Cmd.convertWebToJWLibrary,
      text: 'Convert jw.org url to JW Library',
      icon: 'library',
      fn: (editor) => this.linkToJWLibrary(editor, Cmd.convertWebToJWLibrary),
    },
    {
      id: Cmd.openScriptureInJWLibrary,
      text: 'Open scripture at caret in JW Library',
      icon: 'external-link',
      fn: (editor) => this.openInJWLibrary(editor),
      sep: true,
    },
  ];

  MenuParaCount = {
    text: 'No. of paragraphs to cite?',
    icon: 'pilcrow',
  };

  MenuCitationLink = {
    text: 'Link cited scripture?',
    icon: 'links-going-out',
  };

  /* 🛠️ INTERNAL FUNCTIONS */

  /**
   * In the active editor:
   * (1) the current selection if available, defaults to current line
   * (2) sets selection to current line and returns it
   * Assumes an editor is active!
   * @param {Editor} editor
   * @param {boolean} [setSelection=true] should we select the entire line in the editor?
   * @param {boolean} entireLine select and return entire line
   * @returns {{ string, number, number }} current selection, relative caret position, current line no.
   */
  _getEditorSelection(editor, setSelection = true, entireLine = false) {
    let selection;
    let caret;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    if (!entireLine && editor.somethingSelected()) {
      // either (1) current selection
      // No caret position when user has explicitly selected a section of text/verse
      // caret = cursor.ch + line.indexOf(selection);
      selection = editor.getSelection();
    } else {
      // or (2) current line (select entire line)
      const from = { line: cursor.line, ch: 0 };
      const to = { line: cursor.line, ch: line.length };
      selection = editor.getRange(from, to);
      if (setSelection) {
        editor.setSelection(from, to);
      }
      caret = cursor.ch;
    }
    return { selection, caret, line: cursor.line };
  }

  /**
   * Swaps all jw.org Finder-style and wol.jw.org urls in input text for JW Library app urls
   * @param {string} input
   * @return {{output: string, changed: boolean}} Updated text with swapped links, changed is true if at least one url changed
   */
  _convertWebToJWLibrary(input) {
    let output = input;
    let changed = false;
    const links = this._getLinksInText(input);
    for (const link of links) {
      const mdLink = `[${link.title}](${Config.jwlFinder}&docid=${link.docId}&par=${link.parId})`;
      output = output.replace(link.whole, mdLink);
      changed = true;
    }
    return { output, changed };
  }

  /**
   * Replaces ALL valid scripture references in input text with links
   * Result depends on DisplayType:
   * 1. JW Library MD links []()
   * 2. Href links
   * 3. Plain url
   * @param {string} input
   * @param {DisplayType} displayType
   * @return {{output: string, changed: boolean}}
   */
  _convertScriptureToJWLibrary(input, displayType, caret = undefined) {
    let output = input;
    let changed = false; // true if at least one scripture reference was recognised

    // HACK 🚧 references in headings and callouts break formatting...
    // Only accept text elements for now
    const isTextElem = !(input.startsWith('<h') || input.startsWith('<div data'));

    if (isTextElem) {
      /** @type {TReference} */
      for (const reference of this._getAllScriptureLinks(input, displayType, this.settings.spaceAfterPunct, caret)) {
        if (!reference.isLinkAlready) {
          let referenceMarkup = '';
          /** @type {TPassage} */
          for (const passage of reference.passages) {
            let markup = passage.display;
            if (passage.link) {
              if (displayType === DisplayType.md) {
                markup = `[${passage.display}](${passage.link.jwlib})`;
              } else if (displayType === DisplayType.href) {
                markup = `<a href="${passage.link.jwlib}" title="${passage.link.jwlib}">${passage.display}</a>`; // make the target URL visible on hover
              } else if (displayType === DisplayType.url) {
                markup = passage.link.jwlib;
              }
            }
            referenceMarkup += passage.delimiter + markup;
          }
          if (displayType === DisplayType.url) {
            output = referenceMarkup;
          } else {
            output = output.replace(reference.original, referenceMarkup);
          }
          changed = true;
        }
      }
    }
    return { output, changed };
  }

  /**
   * Provides a sanitized, formatted bible citation on the line below the scripture reference
   * from jw.org html page, could include a JW Library link (see settings.citationLink)
   * @param {string} input Text containing the scripture (current line | current selection)
   * @param {View} view
   * @param {number} caret Current caret position in the input if no selection
   * @param {Cmd} command
   * @returns {string}
   */
  async _fetchBibleCitation(input, view, caret, command) {
    /** @type {TReferences} */
    const references = this._getAllScriptureLinks(input, DisplayType.cite, this.settings.spaceAfterPunct, caret);
    if (references) {
      const output = [];
      output.push(input); // keep original input on first line
      for (const reference of references) {
        let dom = ''; // cache the dom if possible
        let prevChapter = '';
        for (const passage of reference.passages) {
          if (passage.error === OutputError.invalidScripture) {
            output.push(`${passage.displayFull} | ${Lang[OutputError.invalidScripture]}`);
            continue;
          }
          let title = passage.displayFull; // default
          if (this.settings.citationLink) {
            title = `[${title}](${passage.link.jwlib})`;
          }
          let verses = [];
          const cache = view.getFromHistory(passage.link.jwlib); // try the cache first
          if (cache) {
            verses = cache.content;
          } else {
            // reuse the previous dom if the chapter is the same
            if (passage.chapter !== prevChapter) {
              dom = await this._fetchDOM(passage.link.jworg);
              prevChapter = passage.chapter;
            }
            for (const id of passage.link.parIds) {
              const follows = verses.length > 0;
              let clean = this._getElementAsText(dom, `#v${id}`, TargetType.scripture, follows);
              clean = this._boldInitialNumber(clean);
              verses.push(clean);
            }
          }
          if (verses) {
            view.addToHistory(passage.link.jwlib, title, verses);
            view.showHistory();
            const text = verses.join('');
            let template = '';
            if (command === Cmd.citeVerse) {
              template = this.settings.verseTemplate;
            } else if (command === Cmd.citeVerseCallout) {
              template = this.settings.verseCalloutTemplate;
            }
            const citation = template.replace('{title}', title).replace('{text}', text);
            output.push(citation);
          } else {
            output.push(`${passage.displayFull} | ${Lang[OutputError.onlineLookupFailed]}`);
          }
        }
      }
      return output.join('\n');
    }
    return Lang[OutputError.noMatch];
  }

  /**
   * Inserts a sanitized, formatted paragraph citation below a valid wol.jw.org or finder url
   * @param {string} input text containing a jw.org/finder or wol.jw.org URL
   * @param {View} view
   * @param {number} caret position of the caret in the input
   * @param {Cmd} command full paragraph, inline or title only
   * @param {number} pars number of paragraphs to extract (1-3 right now)
   * @returns {string}
   */
  async _fetchParagraphCitation(input, view, caret, command, pars) {
    const match = this._getLinkAtCaret(input, caret);
    if (!match) {
      return Lang[OutputError.noMatch];
    }
    if (!URL.canParse(match.url)) {
      return Lang[OutputError.invalidUrl];
    }
    let link = '';
    let content = [];
    const cache = view.getFromHistory(match.url, pars);
    if (cache) {
      link = cache.link;
      content = cache.content;
    } else {
      const dom = await this._fetchDOM(match.url);
      if (dom) {
        const pageTitle = this._getElementAsText(dom, 'title', TargetType.jwonline);
        const pageNav = this._getElementAsText(dom, '#publicationNavigation', TargetType.pubNav);
        const display = pageNav || pageTitle;
        link = `[${display}](${match.url})`;
        // Look for a wol/finder paragraph html #id
        // Title link only has no content
        if (command !== Cmd.addLinkTitle && match.parId) {
          for (let i = 0; i < pars; i++) {
            let par = this._getElementAsText(dom, `#p${match.parId}${i}`, TargetType.jwonline);
            if (par.trim() === '') {
              par = Lang.emptyPara;
            }
            content.push(par);
          }
        }
      }
    }
    if (link) {
      view.addToHistory(match.url, link, content);
      view.showHistory();
      let output = '';
      // replace the raw url to a full MD link
      if (command === Cmd.addLinkTitle) {
        output = input.replace(match.whole, link);
      } else {
        let template;
        let text = '';
        if (command === Cmd.citeParagraph) {
          template = this.settings.pubTemplate;
          text = content.join('');
        } else if (command === Cmd.citeParagraphCallout) {
          template = this.settings.pubCalloutTemplate;
          const glue = template[0] === '>' ? '\n>\n>' : '\n';
          text = content.join(glue);
          text = this._boldInitialNumber(text);
        }
        const citation = template.replace('{title}', link).replace('{text}', text);
        output = `${input}\n${citation}`;
      }
      return output;
    }
    return Lang[OutputError.onlineLookupFailed];
  }

  /**
   * Fetch wol.jw.org pub references (aka: 'publication reference lookup')
   * @param {string} input A valid WT style publication reference (copy of selection)
   * @param {View} view For history functions
   * @return {{string}, {boolean}, {OutputError}}
   */
  async _fetchLookupCitation(input, view) {
    // Convert WT pub lookup into WT search url syntax
    const lookupUrl = Config.wolLookup + encodeURIComponent(input).replace(/%20/g, '+');
    let link = '';
    let content = [];
    let text = '';
    const cache = view.getFromHistory(lookupUrl); // try the cache first
    if (cache) {
      link = cache.link;
      content = cache.content;
    } else {
      const dom = await this._fetchDOM(lookupUrl);
      if (dom) {
        const query = this._getElementAsText(dom, '.searchText', TargetType.jwonline);
        const display = this._getElementAsText(dom, '.cardLine1', TargetType.jwonline);
        link = `[${query} | ${display}](${lookupUrl})`; // (hard coded formatting)
        text = this._getElementAsText(dom, '.resultItems', TargetType.jwonline);
        content.push(text);
      }
    }
    if (link) {
      view.addToHistory(lookupUrl, link, content);
      view.showHistory();
      text = content.join('');
      text = this._boldInitialNumber(text);
      const template = this.settings.pubCalloutTemplate;
      // Check if template is actually a callout (user editable):
      // If so all lines need to be part of the callout syntax
      if (template[0] === '>') {
        text = text.replace(/^./gm, '>$&').substring(1);
      }
      const citation = template.replace('{title}', link).replace('{text}', text);
      // Insert the citation below the lookup query (hard coded formatting)
      const output = `${input}\n${citation}`;
      return output;
    }
    return Lang[OutputError.onlineLookupFailed];
  }

  /**
   * Fetch the entire DOM from a web page url
   * @param {string} url
   * @returns {Promise<Document|Null>}
   */
  async _fetchDOM(url) {
    try {
      const res = await requestUrl(url);
      if (res.status === 200) {
        return new DOMParser().parseFromString(res.text, 'text/html');
      }
    } catch (error) {
      //// biome-ignore lint/suspicious/noConsoleLog: ⚠️
      console.log(error);
    }
    return null;
  }

  /**
   * Make paragraph number bold, e.g. **4**
   * @param {*} text Verse or paragraph from WT online
   * @returns {string}
   */
  _boldInitialNumber(text) {
    if (this.settings.boldInitialNum) {
      return text.replace(Config.initialNumRegex, '$1**$2** ');
    }
    return text;
  }

  /**
   * Extract a specific HTML element from the DOM based on the selector
   * Convert to plain text and remove markup and unneeded character depending on type
   * (Try to keep all this messy html cleanup in one place)
   * Target types:
   * 1. scripture: from /finder?, need to add line breaks, remove &nbsp;
   * 2. jwonline: paragraph or article, linebreaks? etc.
   * 3. pubNav: the navigation title for a specific page location
   * Returns plain text string
   * @param {Document} dom  Entire DOM for a webpage url
   * @param {string} selector Valid html selector
   * @param {TargetType} type How the text should be converted, scriptures are more complicated
   * @param {boolean} [follows] Does this element come after previous sibling?
   * @return {string} Empty string implies that the selector failed
   */
  _getElementAsText(dom, selector, type, follows = false) {
    let text = '';
    const elem = dom.querySelector(selector) ?? null;
    if (elem) {
      if (type === TargetType.scripture) {
        // for scriptures we need access to the html first to find the WT formatting linebreaks
        let html = elem.innerHTML;
        const blocks = ['<span class="newblock"></span>', '<span class="parabreak"></span>'].map(
          (el) => new RegExp(el, 'gm'),
        );
        for (const el of blocks) {
          html = html.replace(el, '\n');
        }
        // Now remove html tags
        text = new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();
        // Check for initial chapter numbers (always first element) and replace with 1
        if (elem.querySelector('.chapterNum')) {
          text = text.replace(Config.initialNumRegex, '1 ');
          // Is it block or inline verse styling for following verses?
          // Do we need to prepend a space/newline?
        } else if (follows) {
          const prependLF = elem.firstChild.hasClass('style-l') || elem.firstChild.hasClass('newblock');
          if (prependLF) {
            text = `\n${text}`;
          } else {
            text = ` ${text}`;
          }
        }
      } else {
        text = elem.textContent.trim();
      }
      if (type === TargetType.scripture || type === TargetType.jwonline) {
        text = text
          .replace(/[\u00A0\u202F]/gm, ' ') // &nbsp; &nnbsp; WT use them after initial numbers
          .replace(/([,.;])(\w)/gm, '$1 $2') // punctuation without a space after
          .replace(/[\+\*\#]/gm, '') // remove symbols used for annotations
          .replace(/\r\n/gm, '\n') // LF only
          .replace(/\n{2,4}/gm, '\n'); // reduce to single linebreaks only
      } else if (type === TargetType.pubNav) {
        text = text
          .replace(/\t/gm, ' ') // tabs
          .replace(/[\n\r]/gm, ' '); // no linebreaks
      }
      text = text.replace(/ {2,}/gim, ' '); // reduce multiple spaces to single
      return text;
    }
    return text;
  }

  /**
   * Looks for all JW web links in the input text
   * Either wol.jw.org/... or jw.org/finder... style links are accepted
   * Return an array of matching links or empty array
   * @param {string} input
   * @param {number?} caret
   * @returns {Array<TJWLink>}
   */
  _getLinksInText(input) {
    const links = [];
    const matches = input.matchAll(Config.jworgLinkRegex);
    for (const match of matches) {
      links.push(this._extractLinkParts(match));
    }
    return links;
  }

  /**
   * Looks for JW web links, returns the one nearest the caret
   * Either wol.jw.org/... or jw.org/finder... style links are accepted
   * Return the link nearest to the caret position, or null
   * @param {string} input
   * @param {number?} caret
   * @returns {TJWLink|null}
   */
  _getLinkAtCaret(input, caret) {
    let output = null;
    const matches = input.matchAll(Config.jworgLinkRegex);
    for (const match of matches) {
      const begin = match.index;
      const end = begin + match[0].length;
      if (caret >= begin && caret <= end) {
        output = this._extractLinkParts(match);
        break;
      }
    }
    return output;
  }

  /**
   * Try to match and return potential scripture references in the input string
   * If caret position is provided then match only the nearest scripture to caret
   * Returns an array scripture references, one reference = passages within a bible book,
   *   each containing an array of passages, one passage = span of consecutive bible verses
   * @param {string} input            Full input text
   * @param {DisplayType} displayType How will this be displayed?
   * @param {boolean} spaceAfterPunct Add a space after , or ; punctuation; for display purposes
   * @param {number|undefined} [caret]          Caret position 0+ | undefined
   * @returns {Array<TReference>|TReference} array list of references | reference (at caret)
   */
  _getAllScriptureLinks(input, displayType, spaceAfterPunct = false, caret = undefined) {
    /** @type {array<TReference>} */
    const references = [];
    const spc = spaceAfterPunct ? ' ' : '';
    const ct = '|'; // used to signal the caret location - Ascii unit separator

    const matchesNormal = input.matchAll(Config.scriptureRegex);
    const matchesNoChp = input.matchAll(Config.scriptureNoChpRegex); // phm, 2jo, 3jo, jude
    const matches = [...matchesNormal, ...matchesNoChp];
    let referenceCnt = 0;
    let noChapter = false;
    // match[] => [1] whole scripture match [2] is plain text? [3] book name [4] chapter/verse passages [5] is already link?
    for (const match of matches) {
      let atCaret = false;
      let original = match[1];
      let origPassages = match[4].toString();
      if (!origPassages.includes(':')) {
        origPassages = `1:${origPassages}`;
        noChapter = true;
      }
      // remove the last semi-colon in a list of passages
      if (original.slice(-1) === ';') {
        original = original.slice(0, -1);
        origPassages = origPassages.slice(0, -1);
      }
      /** @type {TReference} */
      let reference = {
        original: original,
        book: match[3],
        passages: [],
        isPlainText: Boolean(match[2]), // ' => skip this verse, no link
        isLinkAlready: Boolean(match[5]), // ] or </a> at end => this is already a Wiki/URL link | ' before the verse to skip auto-linking
      };
      // add a sentinel value as a caret locator in the *original* scripture passage
      // NOTE: we cannot add it to the original reference as it would disrupt the regex match
      // makes it easy to find the caret once the reference has been split up (parsed)
      const refBegin = match.index;
      const refLength = match[1].length;
      const bookLength = match[2].length + match[3].length; // plain text marker and book name length
      if (caret) {
        const caretBook = caret - refBegin; // caret relative to this reference
        if (caretBook < bookLength) {
          atCaret = true; // found the caret in book name
        } else if (caretBook >= bookLength && caretBook <= refLength) {
          const caretPassage = caretBook - bookLength;
          // insert sentinnel
          origPassages = `${origPassages.substring(0, caretPassage)}${ct}${origPassages.substring(caretPassage)}`;
        }
      }
      const rawPassages = origPassages.split(';');
      let chapterCnt = 0;
      for (const rawPassage of rawPassages) {
        let [chapter, verses] = rawPassage.split(':');
        chapter = chapter.trim();
        let verseCnt = 0;
        for (let rawVerse of joinConsecutiveVerses(verses.split(','))) {
          // look for the caret locator first, remove if found!
          if (chapter.includes(ct)) {
            atCaret = true; // found caret in chapter
            chapter = chapter.replace(ct, '');
          } else if (rawVerse.includes(ct)) {
            atCaret = true; // found caret in verse
            rawVerse = rawVerse.replace(ct, '');
          }

          // try to convert the verse into a span: first => last (inclusive)
          const verse = {};
          for (const delim of ['-', ',']) {
            if (rawVerse.includes(delim)) {
              const ab = rawVerse.trim().split(delim);
              verse.first = Number(ab[0]);
              verse.last = Number(ab[1]);
              if (verse.last < verse.first) {
                verse.last = verse.first;
              }
              verse.separator = delim;
              break;
            }
          }
          // must be a single verse
          if (!verse.first) {
            verse.first = Number(rawVerse);
            verse.last = verse.first;
            verse.separator = '';
          }
          if (displayType === DisplayType.find) {
            verse.last = verse.first;
          }

          let delimiter = '';
          if (chapterCnt > 0 && verseCnt === 0) {
            delimiter = `;${spc}`;
          } else if (verseCnt > 0) {
            delimiter = `,${spc}`;
          }

          /** @type {PrefixType} */
          let prefixType = PrefixType.showNone;
          if (caret && atCaret) {
            prefixType = PrefixType.showBookChapter;
          } else {
            if (chapterCnt === 0) {
              prefixType = PrefixType.showBookChapter;
            } else if (verseCnt === 0) {
              prefixType = PrefixType.showChapter;
            }
          }

          const passage = {
            prefixType: prefixType, // whether to add the book/chapter prefix
            delimiter: delimiter, // , or ;
            display: reference.book, // fallback: original book as entered by user
            chapter: chapter,
            verse: verse, // first, last, separator
            link: null,
            error: OutputError.none,
            noChapter: noChapter,
          };

          // Special case: if caret is defined then we ignore other matches,
          // we simply look for the one at the caret
          if (caret) {
            if (atCaret) {
              reference.passages.push(passage);
              reference = validateReference(reference, displayType);
              references.push(reference);
              return references; // return immediately, no need to process further
            }
          } else {
            reference.passages.push(passage);
            // if 'find' type then return the first match immediately (always a single verse reference)
            if (displayType === DisplayType.find) {
              reference = validateReference(reference, displayType);
              return reference;
            }
          }
          verseCnt++;
        }
        chapterCnt++;
      }
      // only collect references if there is no caret!
      if (!caret) {
        reference = validateReference(reference, displayType);
        references.push(reference);
      }
      referenceCnt++;
    }
    return references ? references : null;

    /**
     * INTERNAL
     * Process all chap/verse passages in a scripture reference and returns:
     * 1. The valid, canonical display version (ps 5:10 => Psalms 5:10)
     * 2. The correct jw scripture ID for the url args, in JWLib and wol.jw.org versions
     * 3. An array of scripture IDs (one for each verse in a range)
     *    needed to fetch the verse citations [optional]
     * @param {import('main').TReference} reference Scripture reference (same book, many chapter/verse passages)
     * @param {DisplayType} displayType plain, md, url, cite, find
     * @returns {TReference}
     */
    function validateReference(reference, displayType) {
      const lang = Languages[DEFAULT_SETTINGS.lang]; // No user setting available for this yet

      // First is this a valid bible book?
      // *********************************
      // The abbreviation list has no spaces: e.g. 1kings 1ki matthew matt mt
      // Use (^| ) ( |$) to avoid matching inside book names, e.g. eph in zepheniah
      let bookNum = 0;
      const bookRgx = new RegExp(`(^| )${reference.book.replace(' ', '').replace('.', '').toLowerCase()}( |$)`, 'm'); // no spaces or .
      const bookMatch = Bible[lang].Abbreviation.findIndex((elem) => elem.search(bookRgx) !== -1);
      if (bookMatch !== -1) {
        reference.book = Bible[lang].Book[bookMatch];
        bookNum = bookMatch + 1;
      }

      // Now handle each chapter:verse(s) passage
      /** @type {TPassage} */
      for (const passage of reference.passages) {
        const first = passage.verse.first;
        const last = passage.verse.last;

        // Build a canonical bible scripture reference
        // *******************************************
        // NOTE: passage.display default is the original book text from user
        const chapter = passage.noChapter ? '' : `${passage.chapter}:`;
        const bookChapter = `${reference.book} ${chapter}`;
        if (passage.prefixType === PrefixType.showBookChapter) {
          passage.display = bookChapter;
        } else if (passage.prefixType === PrefixType.showChapter) {
          passage.display = chapter;
        }
        const verseSpan = first + (last > first ? passage.verse.separator + last : '');
        passage.display += verseSpan;
        passage.displayFull = bookChapter + verseSpan;

        // Add the hyperlinks
        // ******************
        // Does this chapter and verse range exist in the bible? If so, create the link
        let link = {};
        const bcLookup = `${reference.book} ${passage.chapter}`;
        if (bcLookup in BibleDimensions && first <= BibleDimensions[bcLookup] && last <= BibleDimensions[bcLookup]) {
          /** @type {TLink} */
          link = {
            jwlib: '',
            jworg: '',
            parIds: [],
          };
          // Handle the verse link id
          // Format: e.g. Genesis 2:6
          // Book|Chapter|Verse
          //  01 |  002  | 006  = 01001006
          // Verse range = 01001006-01001010 e.g. Gen 2:6-10
          // 🔥IMPORTANT: with jw.org par ids the leading 0 is skipped!
          if (displayType !== DisplayType.plain || displayType !== DisplayType.find) {
            const bookChapId = bookNum.toString() + passage.chapter.toString().padStart(3, '0');
            let id = bookChapId + first.toString().padStart(3, '0');
            if (last > first) {
              id += `-${bookChapId}${last.toString().padStart(3, '0')}`;
            }
            // Seems that the Windows version of JWLibrary needs the locale to be set.
            link.jwlib = `${Config.jwlFinder}${Config.urlParam}${id}${Config.jwlLocale}`;

            // Finally, handle the (verse) par ids used to fetch the citation from jw.org
            if (displayType === DisplayType.cite) {
              link.jworg = `${Config.webFinder}${Config.urlParam}${id}`;
              for (let i = first; i <= last; i++) {
                link.parIds.push(bookChapId + i.toString().padStart(3, '0'));
              }
            }
          }
        } else {
          passage.error = OutputError.invalidScripture;
          link = null;
        }
        passage.link = link;
      }
      return reference;
    }

    /**
     * Find consecutive verses and consolidate them into one item
     * E.g. ['1', ' 2'] => ['1, 2']
     * @param {Array<string>} verses
     * @returns {Array<string>}
     */
    function joinConsecutiveVerses(verses) {
      const joined = [];
      const len = verses.length;
      for (let i = 0; i < len; i++) {
        const current = Number(verses[i].replace(ct, ''));
        const next = i < len - 1 ? Number(verses[i + 1].replace(ct, '')) : '';
        if (current === next - 1) {
          joined.push(`${verses[i]},${verses[i + 1]}`);
          i++;
        } else {
          joined.push(verses[i]);
        }
      }
      return joined;
    }
  }

  /**
   * Extracts all the parts of a JW web url
   * Either /finder? style or wol.jw.org style
   * Only accepts publication links, not verses or home page meeting workbook links
   * @param {string} match Regex match of a JW web url (wol or finder style)
   * @returns {TJWLink|null}
   */
  _extractLinkParts(match) {
    let url = match[3];
    let docId = '';
    let parId = '';
    if (url.startsWith(Config.wolRoot)) {
      const id = url.split('/').slice(-1)[0];
      if (id?.includes('#h')) {
        [docId, parId] = id.split('#h=', 2);
      } else {
        docId = id ?? '';
      }
    } else if (url.startsWith(Config.webFinder)) {
      const params = new URLSearchParams(url);
      docId = params.get('docid') ?? '';
      parId = params.get('par') ?? '';
      if (docId) {
        // switch the link style from finder to wol
        // so that we can scrape the paragraph content later if needed
        url = `${Config.wolPublications}${docId}#h=${parId}`;
      } else {
        return null;
      }
    } else {
      return null;
    }
    return {
      whole: match[0],
      title: match[1] ? match[2] : Lang.noTitle,
      url: url,
      docId: docId,
      parId: parId,
    };
  }

  /**
   * Returns the first X words from the sentence provided
   * @param {string} sentence
   * @param {number} count how many words; 0 = full verse
   * @returns {string} some or all words in sentence
   */
  _firstXWords(sentence, count) {
    if (count === 0) {
      return sentence;
    }
    const words = sentence.split(/\s/);
    if (words.length > count) {
      return `${words.slice(0, count).join(' ')} …`;
    }
    return sentence;
  }
}

class JWLLinkerView extends ItemView {
  constructor(leaf, settings) {
    super(leaf);
    this.settings = settings;
    this.historyEl;
    /** @type {Array<THistory>} */
    this.history = [];
    this.helpEl;
    this.expandHelpEl;
    this.helpExpanded = true;
  }

  getViewType() {
    return JWL_LINKER_VIEW;
  }

  getDisplayText() {
    return Lang.name;
  }

  getIcon() {
    return 'gem';
  }

  // Update View state from workspace.json
  async setState(state, result) {
    this.history = state.history ?? [];
    this.showHistory();
    await super.setState(state, result);
  }

  // Get current View state and save to workspace.json
  getState() {
    const state = super.getState();
    state.history = this.history; // update to the new state
    return state; // return the updated state, will be saved to workspace.json
  }

  async onOpen() {
    this.renderView();
  }

  async onClose() {
    this.unload();
  }

  renderView() {
    this.historyEl = this.contentEl.createDiv({ cls: 'jwl' });

    const detailsEl = createEl('details');
    detailsEl.createEl('summary', { text: Lang.help });
    detailsEl.createEl('p', { text: Lang.helpIntro });
    const detailEl = detailsEl.createEl('ul');
    detailEl.createEl('li', { text: Lang.helpCopy });
    const wipeEl = detailEl.createEl('li', {
      text: Lang.helpClear,
      cls: 'clear-history',
    });
    this.contentEl.append(detailsEl);

    this.showHistory;

    this.historyEl.onclick = (event) => {
      if (event.target.tagName === 'P') {
        const item = this.history[event.target.parentElement.parentElement.id];
        if (item) {
          const md = `${item.link}\n${item.content}`;
          navigator.clipboard.writeText(md);
          new Notice(Lang.copiedHistoryMsg, 2000);
        }
      }
    };

    wipeEl.onclick = () => {
      this.clearHistory();
    };
  }

  /* 🕒 HISTORY FUNCTIONS */

  showHistory() {
    this.historyEl.empty();
    if (this.history.length > 0) {
      const parent = new MarkdownRenderChild(this.containerEl);
      this.history.forEach((item, index) => {
        const itemEl = this.historyEl.createDiv({
          cls: 'item',
          attr: { id: index },
        });
        const linkEl = itemEl.createEl('p');
        const pars = item.content.length > 1 ? `\u{2002}¶\u{2008}${item.content.length}` : '';
        MarkdownRenderer.render(this.app, item.link + pars, linkEl, '/', parent);
        const textEl = itemEl.createEl('p');
        MarkdownRenderer.render(this.app, item.content.join(''), textEl, '/', parent);
      });
    } else {
      this.historyEl.createDiv({ cls: 'pane-empty', text: Lang.noHistoryYet });
    }
  }

  /**
   * Add a new history item to the top of the list
   * Note: This is part of the View class, as history is stored in the View's state
   * @param {string} url Primary key
   * @param {string} link The MD link
   * @param {Array} content The text content (array of strings)
   * @param {number} pars Treat 1-3 paragraphs as separate history items; lookup and verses anyway unique urls
   */
  addToHistory(url, link, content, pars = null) {
    /** @type {THistory} */
    const newItem = { key: url + (pars ?? ''), url, link, content };
    this.history = this.history.filter((item) => item.key !== newItem.key); // no duplicates
    this.history = [newItem, ...this.history]; // add to the top
    if (this.history.length > this.settings.maxHistory) {
      this.history = this.history.slice(0, this.settings.maxHistory);
    }
    this.app.workspace.requestSaveLayout(); // causes a state save via getState
  }

  /**
   * Grab the cache version of a lookup
   * Return the right number of paragraphs if there are enough else undefined
   * @param {string} url
   * @param {number} pars Paragraph count
   * @returns {THistory|undefined}
   */
  getFromHistory(url, pars = null) {
    const key = url + (pars ?? '');
    const cache = this.history.find((item) => key === item.key);
    return cache;
  }

  clearHistory() {
    this.history = [];
    this.app.workspace.requestSaveLayout();
    this.showHistory();
  }
}

/**
 * Reading View only:
 * Render all Scripture references in this HTML element as a JW Library links instead
 */
class ScripturePostProcessor extends MarkdownRenderChild {
  /**
   * @param {HTMLElement} containerEl
   * @param {Plugin} plugin
   */
  constructor(containerEl, plugin) {
    super(containerEl);
    this.plugin = plugin;
  }

  onload() {
    const { output, changed } = this.plugin._convertScriptureToJWLibrary(this.containerEl.innerHTML, DisplayType.href);
    if (changed) {
      this.containerEl.innerHTML = output;
    }
  }
}

class JWLLinkerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const defaultTemplate = '{title}\n{text}\n';

    containerEl.empty();
    containerEl.addClass('jwl-settings');

    new Setting(containerEl)
      .setName('Display')
      .setDesc('You can use the following substitutions in the templates: {title}, {text}')
      .setHeading();

    new Setting(containerEl)
      .setName('Verse citation template')
      .setDesc('Use this template when citing a span of Bible verses in normal text format')
      .addTextArea((text) => {
        text
          .setPlaceholder(defaultTemplate)
          .setValue(this.plugin.settings.verseTemplate)
          .onChange(async (value) => {
            this.plugin.settings.verseTemplate = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Verse citation template as callout')
      .setDesc('Use this template when citing a span of Bible verses using the callout format')
      .addTextArea((text) => {
        text
          .setPlaceholder(defaultTemplate)
          .setValue(this.plugin.settings.verseCalloutTemplate)
          .onChange(async (value) => {
            this.plugin.settings.verseCalloutTemplate = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Publication citation template')
      .setDesc('Use this template when citing from a publication in normal text formatting (jw.org or article lookup)')
      .addTextArea((text) => {
        text
          .setPlaceholder(defaultTemplate)
          .setValue(this.plugin.settings.pubTemplate)
          .onChange(async (value) => {
            this.plugin.settings.lookupTemplate = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Publication citation template as callout')
      .setDesc('Use this template when citing from a publication using the callout format (jw.org or article lookup)')
      .addTextArea((text) => {
        text
          .setPlaceholder(defaultTemplate)
          .setValue(this.plugin.settings.pubCalloutTemplate)
          .onChange(async (value) => {
            this.plugin.settings.pubCalloutTemplate = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('No. of history items')
      .setDesc('How many history items to show in the sidebar.')
      .addDropdown((drop) => {
        drop
          .addOptions(Lang.historySize)
          .setValue(this.plugin.settings.historySize)
          .onChange(async (value) => {
            this.plugin.settings.historySize = Number(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Initial numbers in bold')
      .setDesc('Apply bold markup to initial numbers in verses or paragraphs in the cited text.')
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.boldInitialNum).onChange(async (value) => {
          this.plugin.settings.boldInitialNum = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Link cited scripture')
      .setDesc('Link scripture reference to JW Library when citing verses.')
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.citationLink).onChange(async (value) => {
          this.plugin.settings.citationLink = value;
          await this.plugin.saveSettings();
        });
      });

    /* Reset section */

    new Setting(containerEl).setName('Reset').setDesc('This cannot be undone.').setHeading();

    new Setting(containerEl)
      .setName('Reset to default')
      .setDesc('Return all settings to their original defaults.')
      .addButton((btn) => {
        btn.setIcon('reset');
        btn.onClick(async () => {
          Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName('Clear history')
      .setDesc('Clear the list of items in the history sidebar.')
      .addButton((btn) => {
        btn.setIcon('reset');
        btn.onClick(async () => {
          this.plugin.view.clearHistory();
        });
      });
  }
}

const TargetType = {
  scripture: 'scripture',
  jwonline: 'jwonline',
  pubNav: 'pubNav',
};

const DisplayType = {
  href: 'href', // HTML href link <a>...</a>
  md: 'md', // Markdown link [](...)
  plain: 'plain', // Plain text: no link, proper case, expanded abbreviations
  cite: 'cite', // Fetch and insert the full verse text
  find: 'find', // For use in a search/find box, first result only
  url: 'url', // Raw url path
};

const PrefixType = {
  showNone: 'showNone',
  showChapter: 'showChapter',
  showBookChapter: 'showBookChapter',
  showBookVerse: 'showBookVerse',
};

const OutputError = {
  none: 'none',
  noMatch: 'noMatch',
  invalidScripture: 'invalidScripture',
  invalidUrl: 'invalidUrl',
  onlineLookupFailed: 'onlineLookupFailed',
};

const Bible = {
  EN: {
    Book: [
      'Genesis',
      'Exodus',
      'Leviticus',
      'Numbers',
      'Deuteronomy',
      'Joshua',
      'Judges',
      'Ruth',
      '1 Samuel',
      '2 Samuel',
      '1 Kings',
      '2 Kings',
      '1 Chronicles',
      '2 Chronicles',
      'Ezra',
      'Nehemiah',
      'Esther',
      'Job',
      'Psalms',
      'Proverbs',
      'Ecclesiastes',
      'Song of Solomon',
      'Isaiah',
      'Jeremiah',
      'Lamentations',
      'Ezekiel',
      'Daniel',
      'Hosea',
      'Joel',
      'Amos',
      'Obadiah',
      'Jonah',
      'Micah',
      'Nahum',
      'Habakkuk',
      'Zephaniah',
      'Haggai',
      'Zechariah',
      'Malachi',
      'Matthew',
      'Mark',
      'Luke',
      'John',
      'Acts',
      'Romans',
      '1 Corinthians',
      '2 Corinthians',
      'Galatians',
      'Ephesians',
      'Philippians',
      'Colossians',
      '1 Thessalonians',
      '2 Thessalonians',
      '1 Timothy',
      '2 Timothy',
      'Titus',
      'Philemon',
      'Hebrews',
      'James',
      '1 Peter',
      '2 Peter',
      '1 John',
      '2 John',
      '3 John',
      'Jude',
      'Revelation',
    ],
    Abbreviation: [
      'genesis ge gen',
      'exodus ex exod',
      'leviticus le lev',
      'numbers nu num',
      'deuteronomy de deut',
      'joshua jos josh',
      'judges jg judg',
      'ruth ru',
      '1samuel 1sa 1sam',
      '2samuel 2sa 2sam',
      '1kings 1ki 1kg',
      '2kings 2ki 2kg',
      '1chronicles 1ch 1chr',
      '2chronicles 2ch 2chr',
      'ezra ezr',
      'nehemiah ne nem',
      'esther es est',
      'job jb',
      'psalms ps psa psalm',
      'proverbs pr pro prov',
      'ecclesiastes ec ecc eccl',
      'song of solomon canticles ca sos sng song',
      'isaiah isa',
      'jeremiah jer',
      'lamentations la lam',
      'ezekiel eze',
      'daniel da dan',
      'hosea ho hos',
      'joel joe joel',
      'amos am amo amos',
      'obadiah ob oba',
      'jonah jon',
      'micah mic',
      'nahum na nah',
      'habakkuk hab',
      'zephaniah zep zeph',
      'haggai hag',
      'zechariah zec zech',
      'malachi mal',
      'matthew mt mat matt',
      'mark mr mk mark',
      'luke lu luke',
      'john joh john',
      'acts ac act',
      'romans ro rom',
      '1corinthians 1co 1cor',
      '2corinthians 2co 2cor',
      'galatians ga gal',
      'ephesians eph',
      'philippians php',
      'colossians col',
      '1thessalonians 1th',
      '2thessalonians 2th',
      '1timothy 1ti 1tim',
      '2timothy 2ti 2tim',
      'titus ti tit',
      'philemon phm',
      'hebrews heb',
      'james jas',
      '1peter 1pe 1pet',
      '2peter 2pe 2pet',
      '1john 1jo 1joh',
      '2john 2jo 2joh',
      '3john 3jo 3joh',
      'jude jud jude',
      'revelation re rev',
    ],
  },
  FR: {
    Book: [
      'Genèse',
      'Exode',
      'Lévitique',
      'Nombres',
      'Deutéronome',
      'Josué',
      'Juges',
      'Ruth',
      '1 Samuel',
      '2 Samuel',
      '1 Rois',
      '2 Rois',
      '1 Chroniques',
      '2 Chroniques',
      'Esdras',
      'Néhémie',
      'Esther',
      'Job',
      'Psaumes',
      'Proverbes',
      'Ecclésiaste',
      'Chant de Salomon',
      'Isaïe',
      'Jérémie',
      'Lamentations',
      'Ézéchiel',
      'Daniel',
      'Osée',
      'Joël',
      'Amos',
      'Abdias',
      'Jonas',
      'Michée',
      'Nahum',
      'Habacuc',
      'Sophonie',
      'Aggée',
      'Zacharie',
      'Malachie',
      'Matthieu',
      'Marc',
      'Luc',
      'Jean',
      'Actes',
      'Romains',
      '1 Corinthiens',
      '2 Corinthiens',
      'Galates',
      'Éphésiens',
      'Philippiens',
      'Colossiens',
      '1 Thessaloniciens',
      '2 Thessaloniciens',
      '1 Timothée',
      '2 Timothée',
      'Tite',
      'Philémon',
      'Hébreux',
      'Jacques',
      '1 Pierre',
      '2 Pierre',
      '1 Jean',
      '2 Jean',
      '3 Jean',
      'Jude',
      'Révélation',
    ],
    Abbreviation: [
      'genèse gen ge',
      'exode exo ex',
      'lévitique lev le',
      'nombres nom',
      'deutéronome de deu deut',
      'josué jos',
      'juges jug',
      'ruth ru',
      '1samuel 1sam 1sa',
      '2samuel 1sam 2sa',
      '1rois 1ro',
      '2rois 2ro',
      '1chroniques 1chr 1ch',
      '2chroniques 2chr 2ch',
      'esdras esd',
      'néhémie neh',
      'esther est',
      'job',
      'psaumes psa ps',
      'proverbes pr pro prov',
      'ecclésiaste ec ecc eccl',
      'chant de salomon chant',
      'isaïe isa is',
      'jérémie jer',
      'lamentations lam la',
      'ézéchiel eze ez',
      'daniel dan da',
      'osée os',
      'joël',
      'amos',
      'abdias abd ab',
      'jonas',
      'michée mic',
      'nahum',
      'habacuc hab',
      'sophonie sph sop',
      'aggée agg ag',
      'zacharie zac',
      'malachie mal',
      'matthieu mt mat matt',
      'marc',
      'luc',
      'jean',
      'actes ac',
      'romains rom ro',
      '1corinthiens 1cor 1co',
      '2corinthiens 2cor 2co',
      'galates gal ga',
      'éphésiens eph',
      'philippiens phil',
      'colossiens col',
      '1thessaloniciens 1th',
      '2thessaloniciens 2th',
      '1timothée 1tim 1ti',
      '2timothée 2tim 2ti',
      'tite',
      'philémon phm',
      'hébreux heb he',
      'jacques jac',
      '1pierre 1pi',
      '2pierre 2pi',
      '1jean 1je',
      '2jean 2je',
      '3jean 3 je',
      'jude',
      'révélation rev re',
    ],
  },
};

const BibleDimensions = {
  'Genesis 1': 31,
  'Genesis 2': 25,
  'Genesis 3': 24,
  'Genesis 4': 26,
  'Genesis 5': 32,
  'Genesis 6': 22,
  'Genesis 7': 24,
  'Genesis 8': 22,
  'Genesis 9': 29,
  'Genesis 10': 32,
  'Genesis 11': 32,
  'Genesis 12': 20,
  'Genesis 13': 18,
  'Genesis 14': 24,
  'Genesis 15': 21,
  'Genesis 16': 16,
  'Genesis 17': 27,
  'Genesis 18': 33,
  'Genesis 19': 38,
  'Genesis 20': 18,
  'Genesis 21': 34,
  'Genesis 22': 24,
  'Genesis 23': 20,
  'Genesis 24': 67,
  'Genesis 25': 34,
  'Genesis 26': 35,
  'Genesis 27': 46,
  'Genesis 28': 22,
  'Genesis 29': 35,
  'Genesis 30': 43,
  'Genesis 31': 55,
  'Genesis 32': 32,
  'Genesis 33': 20,
  'Genesis 34': 31,
  'Genesis 35': 29,
  'Genesis 36': 43,
  'Genesis 37': 36,
  'Genesis 38': 30,
  'Genesis 39': 23,
  'Genesis 40': 23,
  'Genesis 41': 57,
  'Genesis 42': 38,
  'Genesis 43': 34,
  'Genesis 44': 34,
  'Genesis 45': 28,
  'Genesis 46': 34,
  'Genesis 47': 31,
  'Genesis 48': 22,
  'Genesis 49': 33,
  'Genesis 50': 26,
  'Exodus 1': 22,
  'Exodus 2': 25,
  'Exodus 3': 22,
  'Exodus 4': 31,
  'Exodus 5': 23,
  'Exodus 6': 30,
  'Exodus 7': 25,
  'Exodus 8': 32,
  'Exodus 9': 35,
  'Exodus 10': 29,
  'Exodus 11': 10,
  'Exodus 12': 51,
  'Exodus 13': 22,
  'Exodus 14': 31,
  'Exodus 15': 27,
  'Exodus 16': 36,
  'Exodus 17': 16,
  'Exodus 18': 27,
  'Exodus 19': 25,
  'Exodus 20': 26,
  'Exodus 21': 36,
  'Exodus 22': 31,
  'Exodus 23': 33,
  'Exodus 24': 18,
  'Exodus 25': 40,
  'Exodus 26': 37,
  'Exodus 27': 21,
  'Exodus 28': 43,
  'Exodus 29': 46,
  'Exodus 30': 38,
  'Exodus 31': 18,
  'Exodus 32': 35,
  'Exodus 33': 23,
  'Exodus 34': 35,
  'Exodus 35': 35,
  'Exodus 36': 38,
  'Exodus 37': 29,
  'Exodus 38': 31,
  'Exodus 39': 43,
  'Exodus 40': 38,
  'Leviticus 1': 17,
  'Leviticus 2': 16,
  'Leviticus 3': 17,
  'Leviticus 4': 35,
  'Leviticus 5': 19,
  'Leviticus 6': 30,
  'Leviticus 7': 38,
  'Leviticus 8': 36,
  'Leviticus 9': 24,
  'Leviticus 10': 20,
  'Leviticus 11': 47,
  'Leviticus 12': 8,
  'Leviticus 13': 59,
  'Leviticus 14': 57,
  'Leviticus 15': 33,
  'Leviticus 16': 34,
  'Leviticus 17': 16,
  'Leviticus 18': 30,
  'Leviticus 19': 37,
  'Leviticus 20': 27,
  'Leviticus 21': 24,
  'Leviticus 22': 33,
  'Leviticus 23': 44,
  'Leviticus 24': 23,
  'Leviticus 25': 55,
  'Leviticus 26': 46,
  'Leviticus 27': 34,
  'Numbers 1': 54,
  'Numbers 2': 34,
  'Numbers 3': 51,
  'Numbers 4': 49,
  'Numbers 5': 31,
  'Numbers 6': 27,
  'Numbers 7': 89,
  'Numbers 8': 26,
  'Numbers 9': 23,
  'Numbers 10': 36,
  'Numbers 11': 35,
  'Numbers 12': 16,
  'Numbers 13': 33,
  'Numbers 14': 45,
  'Numbers 15': 41,
  'Numbers 16': 50,
  'Numbers 17': 13,
  'Numbers 18': 32,
  'Numbers 19': 22,
  'Numbers 20': 29,
  'Numbers 21': 35,
  'Numbers 22': 41,
  'Numbers 23': 30,
  'Numbers 24': 25,
  'Numbers 25': 18,
  'Numbers 26': 65,
  'Numbers 27': 23,
  'Numbers 28': 31,
  'Numbers 29': 40,
  'Numbers 30': 16,
  'Numbers 31': 54,
  'Numbers 32': 42,
  'Numbers 33': 56,
  'Numbers 34': 29,
  'Numbers 35': 34,
  'Numbers 36': 13,
  'Deuteronomy 1': 46,
  'Deuteronomy 2': 37,
  'Deuteronomy 3': 29,
  'Deuteronomy 4': 49,
  'Deuteronomy 5': 33,
  'Deuteronomy 6': 25,
  'Deuteronomy 7': 26,
  'Deuteronomy 8': 20,
  'Deuteronomy 9': 29,
  'Deuteronomy 10': 22,
  'Deuteronomy 11': 32,
  'Deuteronomy 12': 32,
  'Deuteronomy 13': 18,
  'Deuteronomy 14': 29,
  'Deuteronomy 15': 23,
  'Deuteronomy 16': 22,
  'Deuteronomy 17': 20,
  'Deuteronomy 18': 22,
  'Deuteronomy 19': 21,
  'Deuteronomy 20': 20,
  'Deuteronomy 21': 23,
  'Deuteronomy 22': 30,
  'Deuteronomy 23': 25,
  'Deuteronomy 24': 22,
  'Deuteronomy 25': 19,
  'Deuteronomy 26': 19,
  'Deuteronomy 27': 26,
  'Deuteronomy 28': 68,
  'Deuteronomy 29': 29,
  'Deuteronomy 30': 20,
  'Deuteronomy 31': 30,
  'Deuteronomy 32': 52,
  'Deuteronomy 33': 29,
  'Deuteronomy 34': 12,
  'Joshua 1': 18,
  'Joshua 2': 24,
  'Joshua 3': 17,
  'Joshua 4': 24,
  'Joshua 5': 15,
  'Joshua 6': 27,
  'Joshua 7': 26,
  'Joshua 8': 35,
  'Joshua 9': 27,
  'Joshua 10': 43,
  'Joshua 11': 23,
  'Joshua 12': 24,
  'Joshua 13': 33,
  'Joshua 14': 15,
  'Joshua 15': 63,
  'Joshua 16': 10,
  'Joshua 17': 18,
  'Joshua 18': 28,
  'Joshua 19': 51,
  'Joshua 20': 9,
  'Joshua 21': 45,
  'Joshua 22': 34,
  'Joshua 23': 16,
  'Joshua 24': 33,
  'Judges 1': 36,
  'Judges 2': 23,
  'Judges 3': 31,
  'Judges 4': 24,
  'Judges 5': 31,
  'Judges 6': 40,
  'Judges 7': 25,
  'Judges 8': 35,
  'Judges 9': 57,
  'Judges 10': 18,
  'Judges 11': 40,
  'Judges 12': 15,
  'Judges 13': 25,
  'Judges 14': 20,
  'Judges 15': 20,
  'Judges 16': 31,
  'Judges 17': 13,
  'Judges 18': 31,
  'Judges 19': 30,
  'Judges 20': 48,
  'Judges 21': 25,
  'Ruth 1': 22,
  'Ruth 2': 23,
  'Ruth 3': 18,
  'Ruth 4': 22,
  '1 Samuel 1': 28,
  '1 Samuel 2': 36,
  '1 Samuel 3': 21,
  '1 Samuel 4': 22,
  '1 Samuel 5': 12,
  '1 Samuel 6': 21,
  '1 Samuel 7': 17,
  '1 Samuel 8': 22,
  '1 Samuel 9': 27,
  '1 Samuel 10': 27,
  '1 Samuel 11': 15,
  '1 Samuel 12': 25,
  '1 Samuel 13': 23,
  '1 Samuel 14': 52,
  '1 Samuel 15': 35,
  '1 Samuel 16': 23,
  '1 Samuel 17': 58,
  '1 Samuel 18': 30,
  '1 Samuel 19': 24,
  '1 Samuel 20': 42,
  '1 Samuel 21': 15,
  '1 Samuel 22': 23,
  '1 Samuel 23': 29,
  '1 Samuel 24': 22,
  '1 Samuel 25': 44,
  '1 Samuel 26': 25,
  '1 Samuel 27': 12,
  '1 Samuel 28': 25,
  '1 Samuel 29': 11,
  '1 Samuel 30': 31,
  '1 Samuel 31': 13,
  '2 Samuel 1': 27,
  '2 Samuel 2': 32,
  '2 Samuel 3': 39,
  '2 Samuel 4': 12,
  '2 Samuel 5': 25,
  '2 Samuel 6': 23,
  '2 Samuel 7': 29,
  '2 Samuel 8': 18,
  '2 Samuel 9': 13,
  '2 Samuel 10': 19,
  '2 Samuel 11': 27,
  '2 Samuel 12': 31,
  '2 Samuel 13': 39,
  '2 Samuel 14': 33,
  '2 Samuel 15': 37,
  '2 Samuel 16': 23,
  '2 Samuel 17': 29,
  '2 Samuel 18': 33,
  '2 Samuel 19': 43,
  '2 Samuel 20': 26,
  '2 Samuel 21': 22,
  '2 Samuel 22': 51,
  '2 Samuel 23': 39,
  '2 Samuel 24': 25,
  '1 Kings 1': 53,
  '1 Kings 2': 46,
  '1 Kings 3': 28,
  '1 Kings 4': 34,
  '1 Kings 5': 18,
  '1 Kings 6': 38,
  '1 Kings 7': 51,
  '1 Kings 8': 66,
  '1 Kings 9': 28,
  '1 Kings 10': 29,
  '1 Kings 11': 43,
  '1 Kings 12': 33,
  '1 Kings 13': 34,
  '1 Kings 14': 31,
  '1 Kings 15': 34,
  '1 Kings 16': 34,
  '1 Kings 17': 24,
  '1 Kings 18': 46,
  '1 Kings 19': 21,
  '1 Kings 20': 43,
  '1 Kings 21': 29,
  '1 Kings 22': 53,
  '2 Kings 1': 18,
  '2 Kings 2': 25,
  '2 Kings 3': 27,
  '2 Kings 4': 44,
  '2 Kings 5': 27,
  '2 Kings 6': 33,
  '2 Kings 7': 20,
  '2 Kings 8': 29,
  '2 Kings 9': 37,
  '2 Kings 10': 36,
  '2 Kings 11': 21,
  '2 Kings 12': 21,
  '2 Kings 13': 25,
  '2 Kings 14': 29,
  '2 Kings 15': 38,
  '2 Kings 16': 20,
  '2 Kings 17': 41,
  '2 Kings 18': 37,
  '2 Kings 19': 37,
  '2 Kings 20': 21,
  '2 Kings 21': 26,
  '2 Kings 22': 20,
  '2 Kings 23': 37,
  '2 Kings 24': 20,
  '2 Kings 25': 30,
  '1 Chronicles 1': 54,
  '1 Chronicles 2': 55,
  '1 Chronicles 3': 24,
  '1 Chronicles 4': 43,
  '1 Chronicles 5': 26,
  '1 Chronicles 6': 81,
  '1 Chronicles 7': 40,
  '1 Chronicles 8': 40,
  '1 Chronicles 9': 44,
  '1 Chronicles 10': 14,
  '1 Chronicles 11': 47,
  '1 Chronicles 12': 40,
  '1 Chronicles 13': 14,
  '1 Chronicles 14': 17,
  '1 Chronicles 15': 29,
  '1 Chronicles 16': 43,
  '1 Chronicles 17': 27,
  '1 Chronicles 18': 17,
  '1 Chronicles 19': 19,
  '1 Chronicles 20': 8,
  '1 Chronicles 21': 30,
  '1 Chronicles 22': 19,
  '1 Chronicles 23': 32,
  '1 Chronicles 24': 31,
  '1 Chronicles 25': 31,
  '1 Chronicles 26': 32,
  '1 Chronicles 27': 34,
  '1 Chronicles 28': 21,
  '1 Chronicles 29': 30,
  '2 Chronicles 1': 17,
  '2 Chronicles 2': 18,
  '2 Chronicles 3': 17,
  '2 Chronicles 4': 22,
  '2 Chronicles 5': 14,
  '2 Chronicles 6': 42,
  '2 Chronicles 7': 22,
  '2 Chronicles 8': 18,
  '2 Chronicles 9': 31,
  '2 Chronicles 10': 19,
  '2 Chronicles 11': 23,
  '2 Chronicles 12': 16,
  '2 Chronicles 13': 22,
  '2 Chronicles 14': 15,
  '2 Chronicles 15': 19,
  '2 Chronicles 16': 14,
  '2 Chronicles 17': 19,
  '2 Chronicles 18': 34,
  '2 Chronicles 19': 11,
  '2 Chronicles 20': 37,
  '2 Chronicles 21': 20,
  '2 Chronicles 22': 12,
  '2 Chronicles 23': 21,
  '2 Chronicles 24': 27,
  '2 Chronicles 25': 28,
  '2 Chronicles 26': 23,
  '2 Chronicles 27': 9,
  '2 Chronicles 28': 27,
  '2 Chronicles 29': 36,
  '2 Chronicles 30': 27,
  '2 Chronicles 31': 21,
  '2 Chronicles 32': 33,
  '2 Chronicles 33': 25,
  '2 Chronicles 34': 33,
  '2 Chronicles 35': 27,
  '2 Chronicles 36': 23,
  'Ezra 1': 11,
  'Ezra 2': 70,
  'Ezra 3': 13,
  'Ezra 4': 24,
  'Ezra 5': 17,
  'Ezra 6': 22,
  'Ezra 7': 28,
  'Ezra 8': 36,
  'Ezra 9': 15,
  'Ezra 10': 44,
  'Nehemiah 1': 11,
  'Nehemiah 2': 20,
  'Nehemiah 3': 32,
  'Nehemiah 4': 23,
  'Nehemiah 5': 19,
  'Nehemiah 6': 19,
  'Nehemiah 7': 73,
  'Nehemiah 8': 18,
  'Nehemiah 9': 38,
  'Nehemiah 10': 39,
  'Nehemiah 11': 36,
  'Nehemiah 12': 47,
  'Nehemiah 13': 31,
  'Esther 1': 22,
  'Esther 2': 23,
  'Esther 3': 15,
  'Esther 4': 17,
  'Esther 5': 14,
  'Esther 6': 14,
  'Esther 7': 10,
  'Esther 8': 17,
  'Esther 9': 32,
  'Esther 10': 3,
  'Job 1': 22,
  'Job 2': 13,
  'Job 3': 26,
  'Job 4': 21,
  'Job 5': 27,
  'Job 6': 30,
  'Job 7': 21,
  'Job 8': 22,
  'Job 9': 35,
  'Job 10': 22,
  'Job 11': 20,
  'Job 12': 25,
  'Job 13': 28,
  'Job 14': 22,
  'Job 15': 35,
  'Job 16': 22,
  'Job 17': 16,
  'Job 18': 21,
  'Job 19': 29,
  'Job 20': 29,
  'Job 21': 34,
  'Job 22': 30,
  'Job 23': 17,
  'Job 24': 25,
  'Job 25': 6,
  'Job 26': 14,
  'Job 27': 23,
  'Job 28': 28,
  'Job 29': 25,
  'Job 30': 31,
  'Job 31': 40,
  'Job 32': 22,
  'Job 33': 33,
  'Job 34': 37,
  'Job 35': 16,
  'Job 36': 33,
  'Job 37': 24,
  'Job 38': 41,
  'Job 39': 30,
  'Job 40': 24,
  'Job 41': 34,
  'Job 42': 17,
  'Psalms 1': 6,
  'Psalms 2': 12,
  'Psalms 3': 8,
  'Psalms 4': 8,
  'Psalms 5': 12,
  'Psalms 6': 10,
  'Psalms 7': 17,
  'Psalms 8': 9,
  'Psalms 9': 20,
  'Psalms 10': 18,
  'Psalms 11': 7,
  'Psalms 12': 8,
  'Psalms 13': 6,
  'Psalms 14': 7,
  'Psalms 15': 5,
  'Psalms 16': 11,
  'Psalms 17': 15,
  'Psalms 18': 50,
  'Psalms 19': 14,
  'Psalms 20': 9,
  'Psalms 21': 13,
  'Psalms 22': 31,
  'Psalms 23': 6,
  'Psalms 24': 10,
  'Psalms 25': 22,
  'Psalms 26': 12,
  'Psalms 27': 14,
  'Psalms 28': 9,
  'Psalms 29': 11,
  'Psalms 30': 12,
  'Psalms 31': 24,
  'Psalms 32': 11,
  'Psalms 33': 22,
  'Psalms 34': 22,
  'Psalms 35': 28,
  'Psalms 36': 12,
  'Psalms 37': 40,
  'Psalms 38': 22,
  'Psalms 39': 13,
  'Psalms 40': 17,
  'Psalms 41': 13,
  'Psalms 42': 11,
  'Psalms 43': 5,
  'Psalms 44': 26,
  'Psalms 45': 17,
  'Psalms 46': 11,
  'Psalms 47': 9,
  'Psalms 48': 14,
  'Psalms 49': 20,
  'Psalms 50': 23,
  'Psalms 51': 19,
  'Psalms 52': 9,
  'Psalms 53': 6,
  'Psalms 54': 7,
  'Psalms 55': 23,
  'Psalms 56': 13,
  'Psalms 57': 11,
  'Psalms 58': 11,
  'Psalms 59': 17,
  'Psalms 60': 12,
  'Psalms 61': 8,
  'Psalms 62': 12,
  'Psalms 63': 11,
  'Psalms 64': 10,
  'Psalms 65': 13,
  'Psalms 66': 20,
  'Psalms 67': 7,
  'Psalms 68': 35,
  'Psalms 69': 36,
  'Psalms 70': 5,
  'Psalms 71': 24,
  'Psalms 72': 20,
  'Psalms 73': 28,
  'Psalms 74': 23,
  'Psalms 75': 10,
  'Psalms 76': 12,
  'Psalms 77': 20,
  'Psalms 78': 72,
  'Psalms 79': 13,
  'Psalms 80': 19,
  'Psalms 81': 16,
  'Psalms 82': 8,
  'Psalms 83': 18,
  'Psalms 84': 12,
  'Psalms 85': 13,
  'Psalms 86': 17,
  'Psalms 87': 7,
  'Psalms 88': 18,
  'Psalms 89': 52,
  'Psalms 90': 17,
  'Psalms 91': 16,
  'Psalms 92': 15,
  'Psalms 93': 5,
  'Psalms 94': 23,
  'Psalms 95': 11,
  'Psalms 96': 13,
  'Psalms 97': 12,
  'Psalms 98': 9,
  'Psalms 99': 9,
  'Psalms 100': 5,
  'Psalms 101': 8,
  'Psalms 102': 28,
  'Psalms 103': 22,
  'Psalms 104': 35,
  'Psalms 105': 45,
  'Psalms 106': 48,
  'Psalms 107': 43,
  'Psalms 108': 13,
  'Psalms 109': 31,
  'Psalms 110': 7,
  'Psalms 111': 10,
  'Psalms 112': 10,
  'Psalms 113': 9,
  'Psalms 114': 8,
  'Psalms 115': 18,
  'Psalms 116': 19,
  'Psalms 117': 2,
  'Psalms 118': 29,
  'Psalms 119': 176,
  'Psalms 120': 7,
  'Psalms 121': 8,
  'Psalms 122': 9,
  'Psalms 123': 4,
  'Psalms 124': 8,
  'Psalms 125': 5,
  'Psalms 126': 6,
  'Psalms 127': 5,
  'Psalms 128': 6,
  'Psalms 129': 8,
  'Psalms 130': 8,
  'Psalms 131': 3,
  'Psalms 132': 18,
  'Psalms 133': 3,
  'Psalms 134': 3,
  'Psalms 135': 21,
  'Psalms 136': 26,
  'Psalms 137': 9,
  'Psalms 138': 8,
  'Psalms 139': 24,
  'Psalms 140': 13,
  'Psalms 141': 10,
  'Psalms 142': 7,
  'Psalms 143': 12,
  'Psalms 144': 15,
  'Psalms 145': 21,
  'Psalms 146': 10,
  'Psalms 147': 20,
  'Psalms 148': 14,
  'Psalms 149': 9,
  'Psalms 150': 6,
  'Proverbs 1': 33,
  'Proverbs 2': 22,
  'Proverbs 3': 35,
  'Proverbs 4': 27,
  'Proverbs 5': 23,
  'Proverbs 6': 35,
  'Proverbs 7': 27,
  'Proverbs 8': 36,
  'Proverbs 9': 18,
  'Proverbs 10': 32,
  'Proverbs 11': 31,
  'Proverbs 12': 28,
  'Proverbs 13': 25,
  'Proverbs 14': 35,
  'Proverbs 15': 33,
  'Proverbs 16': 33,
  'Proverbs 17': 28,
  'Proverbs 18': 24,
  'Proverbs 19': 29,
  'Proverbs 20': 30,
  'Proverbs 21': 31,
  'Proverbs 22': 29,
  'Proverbs 23': 35,
  'Proverbs 24': 34,
  'Proverbs 25': 28,
  'Proverbs 26': 28,
  'Proverbs 27': 27,
  'Proverbs 28': 28,
  'Proverbs 29': 27,
  'Proverbs 30': 33,
  'Proverbs 31': 31,
  'Ecclesiastes 1': 18,
  'Ecclesiastes 2': 26,
  'Ecclesiastes 3': 22,
  'Ecclesiastes 4': 16,
  'Ecclesiastes 5': 20,
  'Ecclesiastes 6': 12,
  'Ecclesiastes 7': 29,
  'Ecclesiastes 8': 17,
  'Ecclesiastes 9': 18,
  'Ecclesiastes 10': 20,
  'Ecclesiastes 11': 10,
  'Ecclesiastes 12': 14,
  'Song of Solomon 1': 17,
  'Song of Solomon 2': 17,
  'Song of Solomon 3': 11,
  'Song of Solomon 4': 16,
  'Song of Solomon 5': 16,
  'Song of Solomon 6': 13,
  'Song of Solomon 7': 13,
  'Song of Solomon 8': 14,
  'Isaiah 1': 31,
  'Isaiah 2': 22,
  'Isaiah 3': 26,
  'Isaiah 4': 6,
  'Isaiah 5': 30,
  'Isaiah 6': 13,
  'Isaiah 7': 25,
  'Isaiah 8': 22,
  'Isaiah 9': 21,
  'Isaiah 10': 34,
  'Isaiah 11': 16,
  'Isaiah 12': 6,
  'Isaiah 13': 22,
  'Isaiah 14': 32,
  'Isaiah 15': 9,
  'Isaiah 16': 14,
  'Isaiah 17': 14,
  'Isaiah 18': 7,
  'Isaiah 19': 25,
  'Isaiah 20': 6,
  'Isaiah 21': 17,
  'Isaiah 22': 25,
  'Isaiah 23': 18,
  'Isaiah 24': 23,
  'Isaiah 25': 12,
  'Isaiah 26': 21,
  'Isaiah 27': 13,
  'Isaiah 28': 29,
  'Isaiah 29': 24,
  'Isaiah 30': 33,
  'Isaiah 31': 9,
  'Isaiah 32': 20,
  'Isaiah 33': 24,
  'Isaiah 34': 17,
  'Isaiah 35': 10,
  'Isaiah 36': 22,
  'Isaiah 37': 38,
  'Isaiah 38': 22,
  'Isaiah 39': 8,
  'Isaiah 40': 31,
  'Isaiah 41': 29,
  'Isaiah 42': 25,
  'Isaiah 43': 28,
  'Isaiah 44': 28,
  'Isaiah 45': 25,
  'Isaiah 46': 13,
  'Isaiah 47': 15,
  'Isaiah 48': 22,
  'Isaiah 49': 26,
  'Isaiah 50': 11,
  'Isaiah 51': 23,
  'Isaiah 52': 15,
  'Isaiah 53': 12,
  'Isaiah 54': 17,
  'Isaiah 55': 13,
  'Isaiah 56': 12,
  'Isaiah 57': 21,
  'Isaiah 58': 14,
  'Isaiah 59': 21,
  'Isaiah 60': 22,
  'Isaiah 61': 11,
  'Isaiah 62': 12,
  'Isaiah 63': 19,
  'Isaiah 64': 12,
  'Isaiah 65': 25,
  'Isaiah 66': 24,
  'Jeremiah 1': 19,
  'Jeremiah 2': 37,
  'Jeremiah 3': 25,
  'Jeremiah 4': 31,
  'Jeremiah 5': 31,
  'Jeremiah 6': 30,
  'Jeremiah 7': 34,
  'Jeremiah 8': 22,
  'Jeremiah 9': 26,
  'Jeremiah 10': 25,
  'Jeremiah 11': 23,
  'Jeremiah 12': 17,
  'Jeremiah 13': 27,
  'Jeremiah 14': 22,
  'Jeremiah 15': 21,
  'Jeremiah 16': 21,
  'Jeremiah 17': 27,
  'Jeremiah 18': 23,
  'Jeremiah 19': 15,
  'Jeremiah 20': 18,
  'Jeremiah 21': 14,
  'Jeremiah 22': 30,
  'Jeremiah 23': 40,
  'Jeremiah 24': 10,
  'Jeremiah 25': 38,
  'Jeremiah 26': 24,
  'Jeremiah 27': 22,
  'Jeremiah 28': 17,
  'Jeremiah 29': 32,
  'Jeremiah 30': 24,
  'Jeremiah 31': 40,
  'Jeremiah 32': 44,
  'Jeremiah 33': 26,
  'Jeremiah 34': 22,
  'Jeremiah 35': 19,
  'Jeremiah 36': 32,
  'Jeremiah 37': 21,
  'Jeremiah 38': 28,
  'Jeremiah 39': 18,
  'Jeremiah 40': 16,
  'Jeremiah 41': 18,
  'Jeremiah 42': 22,
  'Jeremiah 43': 13,
  'Jeremiah 44': 30,
  'Jeremiah 45': 5,
  'Jeremiah 46': 28,
  'Jeremiah 47': 7,
  'Jeremiah 48': 47,
  'Jeremiah 49': 39,
  'Jeremiah 50': 46,
  'Jeremiah 51': 64,
  'Jeremiah 52': 34,
  'Lamentations 1': 22,
  'Lamentations 2': 22,
  'Lamentations 3': 66,
  'Lamentations 4': 22,
  'Lamentations 5': 22,
  'Ezekiel 1': 28,
  'Ezekiel 2': 10,
  'Ezekiel 3': 27,
  'Ezekiel 4': 17,
  'Ezekiel 5': 17,
  'Ezekiel 6': 14,
  'Ezekiel 7': 27,
  'Ezekiel 8': 18,
  'Ezekiel 9': 11,
  'Ezekiel 10': 22,
  'Ezekiel 11': 25,
  'Ezekiel 12': 28,
  'Ezekiel 13': 23,
  'Ezekiel 14': 23,
  'Ezekiel 15': 8,
  'Ezekiel 16': 63,
  'Ezekiel 17': 24,
  'Ezekiel 18': 32,
  'Ezekiel 19': 14,
  'Ezekiel 20': 49,
  'Ezekiel 21': 32,
  'Ezekiel 22': 31,
  'Ezekiel 23': 49,
  'Ezekiel 24': 27,
  'Ezekiel 25': 17,
  'Ezekiel 26': 21,
  'Ezekiel 27': 36,
  'Ezekiel 28': 26,
  'Ezekiel 29': 21,
  'Ezekiel 30': 26,
  'Ezekiel 31': 18,
  'Ezekiel 32': 32,
  'Ezekiel 33': 33,
  'Ezekiel 34': 31,
  'Ezekiel 35': 15,
  'Ezekiel 36': 38,
  'Ezekiel 37': 28,
  'Ezekiel 38': 23,
  'Ezekiel 39': 29,
  'Ezekiel 40': 49,
  'Ezekiel 41': 26,
  'Ezekiel 42': 20,
  'Ezekiel 43': 27,
  'Ezekiel 44': 31,
  'Ezekiel 45': 25,
  'Ezekiel 46': 24,
  'Ezekiel 47': 23,
  'Ezekiel 48': 35,
  'Daniel 1': 21,
  'Daniel 2': 49,
  'Daniel 3': 30,
  'Daniel 4': 37,
  'Daniel 5': 31,
  'Daniel 6': 28,
  'Daniel 7': 28,
  'Daniel 8': 27,
  'Daniel 9': 27,
  'Daniel 10': 21,
  'Daniel 11': 45,
  'Daniel 12': 13,
  'Hosea 1': 11,
  'Hosea 2': 23,
  'Hosea 3': 5,
  'Hosea 4': 19,
  'Hosea 5': 15,
  'Hosea 6': 11,
  'Hosea 7': 16,
  'Hosea 8': 14,
  'Hosea 9': 17,
  'Hosea 10': 15,
  'Hosea 11': 12,
  'Hosea 12': 14,
  'Hosea 13': 16,
  'Hosea 14': 9,
  'Joel 1': 20,
  'Joel 2': 32,
  'Joel 3': 21,
  'Amos 1': 15,
  'Amos 2': 16,
  'Amos 3': 15,
  'Amos 4': 13,
  'Amos 5': 27,
  'Amos 6': 14,
  'Amos 7': 17,
  'Amos 8': 14,
  'Amos 9': 15,
  'Obadiah 1': 21, // single
  'Jonah 1': 17,
  'Jonah 2': 10,
  'Jonah 3': 10,
  'Jonah 4': 11,
  'Micah 1': 16,
  'Micah 2': 13,
  'Micah 3': 12,
  'Micah 4': 13,
  'Micah 5': 15,
  'Micah 6': 16,
  'Micah 7': 20,
  'Nahum 1': 15,
  'Nahum 2': 13,
  'Nahum 3': 19,
  'Habakkuk 1': 17,
  'Habakkuk 2': 20,
  'Habakkuk 3': 19,
  'Zephaniah 1': 18,
  'Zephaniah 2': 15,
  'Zephaniah 3': 20,
  'Haggai 1': 15,
  'Haggai 2': 23,
  'Zechariah 1': 21,
  'Zechariah 2': 13,
  'Zechariah 3': 10,
  'Zechariah 4': 14,
  'Zechariah 5': 11,
  'Zechariah 6': 15,
  'Zechariah 7': 14,
  'Zechariah 8': 23,
  'Zechariah 9': 17,
  'Zechariah 10': 12,
  'Zechariah 11': 17,
  'Zechariah 12': 14,
  'Zechariah 13': 9,
  'Zechariah 14': 21,
  'Malachi 1': 14,
  'Malachi 2': 17,
  'Malachi 3': 18,
  'Malachi 4': 6,
  'Matthew 1': 25,
  'Matthew 2': 23,
  'Matthew 3': 17,
  'Matthew 4': 25,
  'Matthew 5': 48,
  'Matthew 6': 34,
  'Matthew 7': 29,
  'Matthew 8': 34,
  'Matthew 9': 38,
  'Matthew 10': 42,
  'Matthew 11': 30,
  'Matthew 12': 49,
  'Matthew 13': 58,
  'Matthew 14': 36,
  'Matthew 15': 39,
  'Matthew 16': 28,
  'Matthew 17': 26,
  'Matthew 18': 34,
  'Matthew 19': 30,
  'Matthew 20': 34,
  'Matthew 21': 46,
  'Matthew 22': 46,
  'Matthew 23': 38,
  'Matthew 24': 51,
  'Matthew 25': 46,
  'Matthew 26': 75,
  'Matthew 27': 66,
  'Matthew 28': 20,
  'Mark 1': 45,
  'Mark 2': 28,
  'Mark 3': 35,
  'Mark 4': 41,
  'Mark 5': 43,
  'Mark 6': 56,
  'Mark 7': 36,
  'Mark 8': 38,
  'Mark 9': 48,
  'Mark 10': 52,
  'Mark 11': 32,
  'Mark 12': 44,
  'Mark 13': 37,
  'Mark 14': 72,
  'Mark 15': 46,
  'Mark 16': 20,
  'Luke 1': 80,
  'Luke 2': 52,
  'Luke 3': 38,
  'Luke 4': 44,
  'Luke 5': 39,
  'Luke 6': 49,
  'Luke 7': 50,
  'Luke 8': 56,
  'Luke 9': 62,
  'Luke 10': 42,
  'Luke 11': 54,
  'Luke 12': 59,
  'Luke 13': 35,
  'Luke 14': 35,
  'Luke 15': 32,
  'Luke 16': 31,
  'Luke 17': 36,
  'Luke 18': 43,
  'Luke 19': 48,
  'Luke 20': 47,
  'Luke 21': 38,
  'Luke 22': 71,
  'Luke 23': 55,
  'Luke 24': 53,
  'John 1': 51,
  'John 2': 25,
  'John 3': 36,
  'John 4': 54,
  'John 5': 46,
  'John 6': 71,
  'John 7': 52,
  'John 8': 48,
  'John 9': 41,
  'John 10': 42,
  'John 11': 57,
  'John 12': 50,
  'John 13': 38,
  'John 14': 31,
  'John 15': 27,
  'John 16': 33,
  'John 17': 26,
  'John 18': 40,
  'John 19': 42,
  'John 20': 31,
  'John 21': 25,
  'Acts 1': 26,
  'Acts 2': 47,
  'Acts 3': 26,
  'Acts 4': 37,
  'Acts 5': 42,
  'Acts 6': 15,
  'Acts 7': 60,
  'Acts 8': 39,
  'Acts 9': 43,
  'Acts 10': 48,
  'Acts 11': 30,
  'Acts 12': 25,
  'Acts 13': 52,
  'Acts 14': 28,
  'Acts 15': 40,
  'Acts 16': 40,
  'Acts 17': 34,
  'Acts 18': 28,
  'Acts 19': 41,
  'Acts 20': 38,
  'Acts 21': 40,
  'Acts 22': 30,
  'Acts 23': 35,
  'Acts 24': 26,
  'Acts 25': 27,
  'Acts 26': 32,
  'Acts 27': 44,
  'Acts 28': 30,
  'Romans 1': 32,
  'Romans 2': 29,
  'Romans 3': 31,
  'Romans 4': 25,
  'Romans 5': 21,
  'Romans 6': 23,
  'Romans 7': 25,
  'Romans 8': 39,
  'Romans 9': 33,
  'Romans 10': 21,
  'Romans 11': 36,
  'Romans 12': 21,
  'Romans 13': 14,
  'Romans 14': 23,
  'Romans 15': 33,
  'Romans 16': 26,
  '1 Corinthians 1': 31,
  '1 Corinthians 2': 16,
  '1 Corinthians 3': 23,
  '1 Corinthians 4': 21,
  '1 Corinthians 5': 13,
  '1 Corinthians 6': 20,
  '1 Corinthians 7': 40,
  '1 Corinthians 8': 13,
  '1 Corinthians 9': 27,
  '1 Corinthians 10': 33,
  '1 Corinthians 11': 34,
  '1 Corinthians 12': 31,
  '1 Corinthians 13': 13,
  '1 Corinthians 14': 40,
  '1 Corinthians 15': 58,
  '1 Corinthians 16': 24,
  '2 Corinthians 1': 24,
  '2 Corinthians 2': 17,
  '2 Corinthians 3': 18,
  '2 Corinthians 4': 18,
  '2 Corinthians 5': 21,
  '2 Corinthians 6': 18,
  '2 Corinthians 7': 16,
  '2 Corinthians 8': 24,
  '2 Corinthians 9': 15,
  '2 Corinthians 10': 18,
  '2 Corinthians 11': 33,
  '2 Corinthians 12': 21,
  '2 Corinthians 13': 14,
  'Galatians 1': 24,
  'Galatians 2': 21,
  'Galatians 3': 29,
  'Galatians 4': 31,
  'Galatians 5': 26,
  'Galatians 6': 18,
  'Ephesians 1': 23,
  'Ephesians 2': 22,
  'Ephesians 3': 21,
  'Ephesians 4': 32,
  'Ephesians 5': 33,
  'Ephesians 6': 24,
  'Philippians 1': 30,
  'Philippians 2': 30,
  'Philippians 3': 21,
  'Philippians 4': 23,
  'Colossians 1': 29,
  'Colossians 2': 23,
  'Colossians 3': 25,
  'Colossians 4': 18,
  '1 Thessalonians 1': 10,
  '1 Thessalonians 2': 20,
  '1 Thessalonians 3': 13,
  '1 Thessalonians 4': 18,
  '1 Thessalonians 5': 28,
  '2 Thessalonians 1': 12,
  '2 Thessalonians 2': 17,
  '2 Thessalonians 3': 18,
  '1 Timothy 1': 20,
  '1 Timothy 2': 15,
  '1 Timothy 3': 16,
  '1 Timothy 4': 16,
  '1 Timothy 5': 25,
  '1 Timothy 6': 21,
  '2 Timothy 1': 18,
  '2 Timothy 2': 26,
  '2 Timothy 3': 17,
  '2 Timothy 4': 22,
  'Titus 1': 16,
  'Titus 2': 15,
  'Titus 3': 15,
  'Philemon 1': 25, // single
  'Hebrews 1': 14,
  'Hebrews 2': 18,
  'Hebrews 3': 19,
  'Hebrews 4': 16,
  'Hebrews 5': 14,
  'Hebrews 6': 20,
  'Hebrews 7': 28,
  'Hebrews 8': 13,
  'Hebrews 9': 28,
  'Hebrews 10': 39,
  'Hebrews 11': 40,
  'Hebrews 12': 29,
  'Hebrews 13': 25,
  'James 1': 27,
  'James 2': 26,
  'James 3': 18,
  'James 4': 17,
  'James 5': 20,
  '1 Peter 1': 25,
  '1 Peter 2': 25,
  '1 Peter 3': 22,
  '1 Peter 4': 19,
  '1 Peter 5': 14,
  '2 Peter 1': 21,
  '2 Peter 2': 22,
  '2 Peter 3': 18,
  '1 John 1': 10,
  '1 John 2': 29,
  '1 John 3': 24,
  '1 John 4': 21,
  '1 John 5': 21,
  '2 John 1': 13, // single
  '3 John 1': 15, // single
  'Jude 1': 25, // single
  'Revelation 1': 20,
  'Revelation 2': 29,
  'Revelation 3': 22,
  'Revelation 4': 11,
  'Revelation 5': 14,
  'Revelation 6': 17,
  'Revelation 7': 17,
  'Revelation 8': 13,
  'Revelation 9': 21,
  'Revelation 10': 11,
  'Revelation 11': 19,
  'Revelation 12': 17,
  'Revelation 13': 18,
  'Revelation 14': 20,
  'Revelation 15': 8,
  'Revelation 16': 21,
  'Revelation 17': 18,
  'Revelation 18': 24,
  'Revelation 19': 21,
  'Revelation 20': 15,
  'Revelation 21': 27,
  'Revelation 22': 21,
};

module.exports = {
  default: JWLLinkerPlugin,
};

/* ✏️ TYPES */

/**
 * A cache history item
 * @typedef {Object} THistory
 * @property {string} key
 * @property {string} url
 * @property {string} link
 * @property {Array<string>} content
 */

/**
 * @typedef {Array<TReference>} TReferences
 */

/**
 * Scripture reference match :      one or more verse passages within same bible book
 * @typedef {Object} TReference
 * @property {string} original      reference as matched, for replacement purposes
 * @property {string} book          book name (and ordinal is needed), no spaces
 * @property {Array<TPassage>} passages  all groups of book/chapter/verse references
 * @property {boolean} isPlainText  treat as plain text (no hyperlink)?
 * @property {boolean} isLinkAlready is already a wiki or MD link?
 */

/**
 * Passage : chapter + contiguous verse span, e.g. 8:1-4 or 9:4,5
 * @typedef {Object} TPassage
 * @property {PrefixType} prefixType  show the full book name [and chapter]?
 * @property {string} delimiter     punctuation symbol before the passage text , or ;
 * @property {string} displayFull   complete bible display name
 * @property {string} display       display name as per original source, could be missing book or chapter
 * @property {number} chapter       chapter number
 * @property {TVerse} verse         verse span (first, last)
 * @property {TLink} link           hyperlink info (null if invalid/plaintext)
 * @property {OutputError} error    possible parsing error
 * @property {boolean} noChapter    is book with no chapter (phm 2jo 3jo jude)
 */

/**
 * Verse span : first to last (inclusive)
 * @typedef {Object} TVerse
 * @property {number} first         first verse in span
 * @property {number} last          last verse in span
 * @property {string} separator     between the verse span - or ,
 */

/**
 * Hyperlink info for a bible passage
 * @typedef {Object} TLink
 * @property {string} jwlib         JWLibrary link for the hyperlink
 * @property {string} jworg         wol.jw.org link to lookup citation
 * @property {Array<string>} parIds list of par ids to lookup each verse content
 * @property {string} bookChapId    book and chapter portion of the par id
 */

/**
 * All the parts of a JW url
 * @typedef {Object} TJWLink
 * @property {string} whole
 * @property {string} title
 * @property {string} url
 * @property {string} docId
 * @property {string} parId
 */
