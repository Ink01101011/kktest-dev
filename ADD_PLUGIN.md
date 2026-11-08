# เพิ่ม plugin ใหม่เข้า marketplace kktest-dev

Checklist สำหรับเพิ่ม plugin ใหม่ใต้ marketplace นี้ มี template เปล่าอยู่ที่ `plugins/_template/`
(`.claude-plugin/plugin.json` + `README.md`) ตัวอย่างของจริงดูได้จาก plugin ที่มีอยู่ เช่น
`memory-keeper` (skill + commands + MCP server + hooks), `kkskills-essentials` (skills อย่างเดียว)

## ขั้นตอน

1. **คัดลอก template**

   ```bash
   cp -r plugins/_template plugins/<plugin-name>
   ```

2. **แก้ `plugins/<plugin-name>/.claude-plugin/plugin.json`**
   - `name` → ชื่อ plugin (kebab-case, ห้ามซ้ำกับ plugin อื่นใน marketplace)
   - `description` → คำอธิบายบรรทัดเดียว
   - `homepage` → เปลี่ยน `PLUGIN_NAME` ใน path เป็นชื่อจริง (branch หลักของ repo คือ `master`)
   - `keywords` → ใส่ให้ตรงกับฟีเจอร์
   - ถ้ามี MCP server: ใส่ `.mcp.json` ใน folder ของ plugin และ `"mcpServers": "./.mcp.json"` ใน
     plugin.json (แบบ memory-keeper) ถ้ามี hooks: `hooks/hooks.json` (แบบ loop-ledger)
     ส่วน `skills/<name>/SKILL.md` และ `commands/*.md` แค่วางไฟล์ไว้

3. **แก้ `plugins/<plugin-name>/README.md`** — แทนที่ `PLUGIN_NAME`, `ONE_LINE_DESCRIPTION`, และส่วน `TODO`

4. **เพิ่ม entry ใน `.claude-plugin/marketplace.json`** — เพิ่ม object ใหม่ใน array `plugins`:

   ```json
   {
     "name": "<plugin-name>",
     "source": "./plugins/<plugin-name>",
     "description": "...",
     "version": "0.1.0",
     "author": { "name": "Ink", "email": "supakit.kitj@gmail.com" },
     "homepage": "https://github.com/Ink01101011/kktest-dev/tree/master/plugins/<plugin-name>",
     "repository": "https://github.com/Ink01101011/kktest-dev",
     "license": "MIT",
     "category": "...",
     "keywords": [],
     "tags": []
   }
   ```

5. **ลงทะเบียนกับ npm package (`kktest-dev` CLI)** — test จะ fail ถ้าข้ามขั้นนี้
   - `tools/lib/catalog.mjs`: เพิ่ม plugin ใน `TIERS` (`portable`, `with-fallbacks`,
     `partly-Claude-only` หรือ `Claude-only` พร้อม `note` ถ้าจำเป็น)
     `tools/test/cli.test.mjs` เช็คว่าทุก folder ใน `plugins/` (ยกเว้นที่ขึ้นต้นด้วย `_`) อยู่ใน `TIERS`
   - `docs/providers.md`: เพิ่มแถวในตาราง `| Plugin | Tier |` (test เดียวกันเช็คว่าทุก plugin ใน `TIERS` อยู่ในตาราง)
   - `package.json` `files`: `SKILL.md`, `references/*.md` และ `plugin.json` ถูก glob ไว้แล้ว
     ถ้า plugin มี MCP server หรือ script ที่ skill อ้างผ่าน `${CLAUDE_PLUGIN_ROOT}/…` ต้องเพิ่ม path
     ทีละไฟล์ (`tools/test/package.test.mjs` เช็คว่าทุกไฟล์ที่ CLI อ่านถูก pack)
   - skill ที่ `description` ยาวเกิน 200 ตัวอักษรต้องมี `metadata.short-description` (≤ 200)
     ไม่งั้น `export --target claude-ai` / `chatgpt` จะ fail

6. **เอกสาร**
   - เพิ่มแถวในตาราง Plugins ของ `README.md` (root) และ link ในส่วน Docs
   - สร้าง `docs/<plugin-name>/CONCEPTS.md` และ `SPEC.md` (ดูรูปแบบจาก plugin อื่นใน `docs/`)
   - เพิ่มบรรทัดใน `CHANGELOG.md`

7. **ตรวจก่อน commit**
   - `name` ใน `plugin.json` == `name` ใน entry ของ `marketplace.json` (ต้องตรงกันเป๊ะ)
   - ไม่มี `PLUGIN_NAME` / `ONE_LINE_DESCRIPTION` / `TODO` หลงเหลือ
   - `claude plugin validate .` และ `claude plugin validate ./plugins/<plugin-name>` ผ่าน
   - test ชุดเดียวกับ CI (`.github/workflows/ci.yml`, รันบน ubuntu / macos / windows × node 22 / latest):

     ```bash
     npm test        # = node tools/run-tests.mjs: tools/test + infographic-diagram (Python)
     node --test "plugins/kktestdev-pack/skills/kk-onboard/scripts/*.test.mjs"
     npm pack --dry-run
     ```

     test ที่ข้ามบน Windows ต้องมีแถวใน `docs/windows.md` (`tools/test/windows.test.mjs` เช็คทั้งสองทาง)

## ข้อควรจำเรื่อง version

- แต่ละ plugin version แยกกันอิสระ (plugin ใหม่เริ่ม `0.1.0` ได้)
- ต้อง bump `version` ให้ตรงกันทั้งใน `plugin.json` และ entry ใน `marketplace.json` ทุกครั้งที่ปล่อยของใหม่
  (`claude plugin validate .` เตือนถ้าไม่ตรงกัน)
- version ของ npm package (`package.json`) และของ marketplace เป็นอีกตัว ปล่อยพร้อม tag `v<version>`
  (ดู "Releasing" ใน `docs/providers.md`)
