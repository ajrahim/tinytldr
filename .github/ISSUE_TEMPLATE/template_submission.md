---
name: Community Template Submission
about: Propose or track a new MIT template for packages/templates
title: "[Template]: "
labels: ["template"]
assignees: ""
---

## Template Overview

- **Template ID:** (e.g. `release-notes-card`)
- **Role:** (`cover` | `body` | `end` | `any`)
- **Supported Sizes:** (`["any"]` or preset list)
- **Variants:** (`light`, `dark`, etc.)
- **License:** MIT

## Checklist

- [ ] `tinytldr template validate <id>` passes at all declared sizes (sample + max-length content)
- [ ] Uses only `--tt-*` custom properties and container query units (`cqw`, `cqh`, `cqmin`)
- [ ] Zero external network requests and zero `<script>` tags
- [ ] All sample assets are generated or CC0 with attribution recorded in `README.md`
