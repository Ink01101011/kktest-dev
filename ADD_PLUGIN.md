# เพิ่ม plugin ใหม่เข้า marketplace kktest-dev

Checklist สำหรับเพิ่ม plugin ใหม่ใต้ marketplace นี้ มี template เปล่าอยู่ที่ `plugins/_template/`

## ขั้นตอน

1. **คัดลอก template**

   ```bash
   cp -r plugins/_template plugins/<plugin-name>
   ```

2. **แก้ `plugins/<plugin-name>/.claude-plugin/plugin.json`**
   - `name` → ชื่อ plugin (kebab-case, ห้ามซ้ำกับ plugin อื่นใน marketplace)
   - `description` → คำอธิบายบรรทัดเดียว
   - `homepage` → เปลี่ยน `PLUGIN_NAME` ใน path เป็นชื่อจริง
   - `keywords` → ใส่ให้ตรงกับฟีเจอร์
   - เพิ่ม `mcpServers` / `hooks` / `commands` ถ้ามี (ดูตัวอย่างจาก memory-keeper)

3. **แก้ `plugins/<plugin-name>/README.md`** — แทนที่ `PLUGIN_NAME`, `ONE_LINE_DESCRIPTION`, และส่วน `TODO`

4. **เพิ่ม entry ใน `.claude-plugin/marketplace.json`** — เพิ่ม object ใหม่ใน array `plugins`:

   ```json
   {
     "name": "<plugin-name>",
     "source": "./plugins/<plugin-name>",
     "description": "...",
     "version": "0.1.0",
     "author": { "name": "Ink", "email": "supakit.kitj@gmail.com" },
     "homepage": "https://github.com/Ink01101011/kktest-dev/tree/main/plugins/<plugin-name>",
     "repository": "https://github.com/Ink01101011/kktest-dev",
     "license": "MIT",
     "category": "...",
     "keywords": [],
     "tags": []
   }
   ```

5. **ตรวจก่อน commit**
   - `name` ใน `plugin.json` == `name` ใน entry ของ `marketplace.json` (ต้องตรงกันเป๊ะ)
   - ไม่มี `PLUGIN_NAME` / `ONE_LINE_DESCRIPTION` / `TODO` หลงเหลือ
   - JSON ทั้งสองไฟล์ parse ผ่าน: `python3 -c "import json,sys; [json.load(open(f)) for f in sys.argv[1:]]" .claude-plugin/marketplace.json plugins/<plugin-name>/.claude-plugin/plugin.json`

## ข้อควรจำเรื่อง version

- แต่ละ plugin version แยกกันอิสระ (plugin ใหม่เริ่ม `0.1.0` ได้ ไม่ต้องอิง memory-keeper)
- ต้อง bump `version` ให้ตรงกันทั้งใน `plugin.json` และ entry ใน `marketplace.json` ทุกครั้งที่ปล่อยของใหม่
