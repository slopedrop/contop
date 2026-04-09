---
name: advanced-workflows
description: Advanced desktop automation tools - form filling, text extraction, cross-app copy, environment variables, system settings, app menus, package installation, and find-and-replace.
version: "1.0.0"
---

# Advanced Desktop Workflows

This skill provides specialized automation tools for complex desktop tasks. These tools orchestrate multiple primitive actions in a single call.

## Available Tools (auto-registered when skill is enabled)

- `fill_form(fields)` - Fill a form by setting field values via accessibility. `fields` is a JSON array of `{"label": "...", "value": "..."}` objects.
- `extract_text(region, element_name)` - Extract text from the screen or a specific UI element.
- `copy_between_apps(source_app, target_app, select_all)` - Copy content between apps via clipboard.
- `set_env_var(name, value, scope)` - Set an environment variable. Scope: "session", "user", or "system".
- `change_setting(setting_path, value)` - Change a system setting by navigating the Settings app.
- `app_menu(app_name, menu_path)` - Navigate an application's menu bar (e.g., "File > Export > PDF").
- `install_app(name, method)` - Install a package via system package manager (winget, brew, apt).
- `find_and_replace_in_files(path, pattern, old_text, new_text, dry_run)` - Find/replace across files. Use `dry_run=True` to preview.

## When to Use
Prefer these workflow tools over manual multi-step sequences. For example, use `copy_between_apps` instead of manually focusing, selecting, copying, switching, and pasting.
