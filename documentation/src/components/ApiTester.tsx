import React, { useState } from 'react';
import styles from './ApiTester.module.css';

interface ApiTesterProps {
  endpoint: string;
  method: string;
  description: string;
}

export default function ApiTester({ endpoint, method, description }: ApiTesterProps) {
  const [baseUrl, setBaseUrl] = useState('http://localhost:3000');
  const [authToken, setAuthToken] = useState('');
  const [requestBody, setRequestBody] = useState('{\n  "message": "Explain protein folding"\n}');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleTest = async () => {
    setLoading(true);
    setResponse('');
    
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const options: RequestInit = {
        method,
        headers,
      };

      if (method !== 'GET' && requestBody) {
        options.body = requestBody;
      }

      const res = await fetch(`${baseUrl}${endpoint}`, options);
      const data = await res.json();
      
      setResponse(JSON.stringify(data, null, 2));
    } catch (error) {
      setResponse(`Error: ${error.message}\n\nNote: This is a live tester. Make sure your API is running at ${baseUrl}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    const curlCommand = `curl -X ${method} ${baseUrl}${endpoint} \\
  -H "Content-Type: application/json"${authToken ? ` \\\n  -H "Authorization: Bearer ${authToken}"` : ''}${method !== 'GET' && requestBody ? ` \\\n  -d '${requestBody.replace(/\n/g, '')}'` : ''}`;
    
    navigator.clipboard.writeText(curlCommand);
  };

  return (
    <div className={styles.apiTester}>
      <div className={styles.header}>
        <span className={styles.method}>{method}</span>
        <span className={styles.endpoint}>{endpoint}</span>
      </div>
      
      <p className={styles.description}>{description}</p>

      <div className={styles.form}>
        <div className={styles.field}>
          <label>Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:3000"
          />
        </div>

        <div className={styles.field}>
          <label>Authorization Token (optional)</label>
          <input
            type="text"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder="Bearer token..."
          />
        </div>

        {method !== 'GET' && (
          <div className={styles.field}>
            <label>Request Body</label>
            <textarea
              value={requestBody}
              onChange={(e) => setRequestBody(e.target.value)}
              rows={6}
            />
          </div>
        )}

        <div className={styles.actions}>
          <button 
            className={styles.testButton}
            onClick={handleTest}
            disabled={loading}
          >
            {loading ? 'Testing...' : '▶ Test Request'}
          </button>
          <button 
            className={styles.copyButton}
            onClick={handleCopy}
          >
            📋 Copy as cURL
          </button>
        </div>

        {response && (
          <div className={styles.response}>
            <label>Response</label>
            <pre>{response}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

