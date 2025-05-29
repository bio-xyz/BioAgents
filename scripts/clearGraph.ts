import axios from "axios";

async function clearOxigraph() {
  try {
    const response = await axios.delete("http://localhost:7878/store");
    if (response.status === 204) {
      console.log("Oxigraph store cleared successfully");
    }
  } catch (error) {
    console.error("Error clearing Oxigraph store:", error);
  }
}

clearOxigraph();
