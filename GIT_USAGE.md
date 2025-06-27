# Git Clone Support

The nosdav server now supports git clone functionality through the `--git` option. When enabled, the server can serve git repositories using the standard git HTTP protocol.

## Setup

### 1. Enable Git Support

Start the server with the `--git` flag:

```bash
node bin/nosdav.js --git
```

Or use the short flag:

```bash
node bin/nosdav.js -g
```

### 2. Create Git Repositories

Create bare git repositories in your data directory:

```bash
# Create a bare repository
git init --bare data/my-project.git

# Or clone an existing repository as bare
git clone --bare https://github.com/user/repo.git data/repo.git
```

### 3. Clone Repositories

Once the server is running with git support enabled, you can clone repositories:

```bash
# Clone from your nosdav server
git clone http://localhost:3118/my-project.git

# Or with HTTPS if SSL is enabled
git clone https://localhost:3118/my-project.git
```

## Features

- **Read-only access**: Clone and fetch operations are supported
- **Push support**: Push operations are enabled (requires proper authentication in production)
- **Standard Git protocol**: Uses `git http-backend` for full compatibility
- **Multiple repositories**: Support multiple repositories in the same server

## Configuration

The git functionality can be configured through:

1. **Command line**: `--git` or `-g`
2. **Interactive setup**: Answer "true" when prompted about git support
3. **Config file**: Set `"git": true` in your config.json

## Security Considerations

- Git support is **disabled by default** for security reasons
- In production, consider implementing authentication for push operations
- Repository access is currently anonymous
- Ensure proper file permissions on git repositories

## Testing

Run the test script to create a test repository:

```bash
node test-git.js
```

This will create a test repository at `data/test-repo.git` that you can use for testing.

## Troubleshooting

### Git not found

If you get "git not found" errors, ensure git is installed and available in your PATH:

```bash
git --version
```

### Repository not found

Ensure your repository ends with `.git` and exists in the data directory:

```bash
ls -la data/
```

### Permission errors

Ensure the server has read/write access to the git repositories:

```bash
chmod -R 755 data/
```

## Example Workflow

1. Start server with git support:

   ```bash
   node bin/nosdav.js --git --port 3118
   ```

2. Create a test repository:

   ```bash
   git init --bare data/example.git
   ```

3. Clone the repository:

   ```bash
   git clone http://localhost:3118/example.git
   ```

4. Make changes and push:
   ```bash
   cd example
   echo "# My Project" > README.md
   git add README.md
   git commit -m "Initial commit"
   git push origin main
   ```
