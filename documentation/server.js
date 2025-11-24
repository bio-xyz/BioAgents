// Simple static file server for documentation
Bun.serve({
  port: process.env.PORT || 8080,
  fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // Handle /docs path
    if (path === "/" || path === "/docs" || path === "/docs/") {
      path = "/index.html";
    } else if (path.startsWith("/docs/")) {
      path = path.slice(5); // Remove /docs prefix
    }

    // Add .html extension if no extension present
    if (!path.includes(".") && !path.endsWith("/")) {
      path = path + ".html";
    }

    // Serve the file
    const file = Bun.file("./public" + path);
    return new Response(file);
  },
});

console.log("📚 Documentation server running on port", process.env.PORT || 8080);

