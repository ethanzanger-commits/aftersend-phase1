export const BASE = 'https://track.example.com';
export const GMAIL_HTML = `
<div id="root1" role="dialog" aria-label="New Message">
  <input name="subjectbox" value="Hello there">
  <div class="afV"><span email="Bob@Example.com">Bob</span></div>
  <input name="to" type="hidden" value="Bob &lt;bob@example.com&gt;, carol@example.com">
  <div aria-label="Message Body" role="textbox" contenteditable="true">
    <div>Hi <a href="https://example.com/a">my site</a> <a href="mailto:x@y.com">mail</a>
    <a href="${BASE}/api/l/AAAAAAAAAAAAAAAAAAAAAA">already tracked</a> <a href="https://example.com/a">dup</a></div>
  </div>
  <div class="btC"><div role="button" data-tooltip="Send (Ctrl-Enter)" aria-label="Send">Send</div></div>
</div>`;
