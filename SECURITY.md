# Security Policy

## Scope

This repo is a developer tool and skill pack for grounded video
evaluation. The highest-risk issues here are usually:

- arbitrary command execution through harness entrypoints
- unsafe file handling in bundle or artifact paths
- dependency or packaging issues that affect installed skill packs
- accidental leakage of sensitive local paths or artifact contents

Model-quality issues or wrong benchmark conclusions are important, but
they are not security issues unless they create a real confidentiality,
integrity, or execution risk.

## Reporting

If you find a security issue, do not open a public issue first.

Email: `hello@calvinkennedy.com`

Include:

- affected commit or release tag
- impacted command or entrypoint
- reproduction steps
- severity and realistic impact

## Supported Versions

This repo is still early-stage. Support is best-effort on:

- the latest `main`
- the latest tagged release
