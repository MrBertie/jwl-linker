# JWL Linker Plugin for [Obsidian](https://obsidian.md)

Display all bible references as *JW Library* links In Reading View. Adds a Command to convert bible references and jw.org 'Finder' links to *JW Library* links in Editing View.

![Logo](logo.png)

# Manual Installation
Create a `jwl-linker` folder under `.obsidian/plugins` in your vault. Add the `main.js` and `manifest.json` files from the latest [release](https://github.com/MrBertie/jwl-linker/releases) to the folder.

>Remember to go to the *Plugin Settings* page in Obsidian and enable the plugin!

# How to Use

The plugin has two key features:

## In **Reading View**

Displays valid bible references as *JW Library* links.
Open any page that contains bible verse references, e.g. `Rom 1:20; Psalm 89:18; 1 Cor 9:26, etc...` and then simply switch to *Reading View.*  

You should see that all bible verse references are now displayed as hyperlinks; in addition any abbreviated bible book names are written out in full.

>Note:
>1. This only changes the *Reading View* not the underlying Markdown text
>2. Bible references in Headings and Callouts do not work yet 🔥
>3. Place a full stop "." after a reference to skip the link

## In **Editing View**

Adds a Command to convert both Bible references and jw.org "Finder" links into permanent *JW Library* links.

You can either:
1. Use the default *Convert to JWL Link* editor command provided (right-click if you are on Desktop, add the command to the Mobile toolbar on phone/tablet)
2. Use a plugin like *Commander* to add the new command wherever you prefer
3. Use the *Command Bar* `Ctrl + P` to call up the command as needed; just start typing "jw..." and it should pop up.

Click anywhere in a line or select text that contains a bible verse reference or a jw.org Finder link [^1].
Then click the *Convert to JWL link* command and the links should be converted immediately.

>Note:
>This option permanently rewrites bible references as a Markdown-style links in the text.  The Reading View option above is non-destructive.
>These links work fine in Headings and Callouts 

## Opening links
Click on the newly created link to open it in your installed *JW Library* app directly at that verse or publication reference.

[^1]: The type of link you get when you click on the Share Link option, either online or in the *JW Library* App.
