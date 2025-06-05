import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { InstructorClient as IC } from "@instructor-ai/instructor";

export type AnthropicImage = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/png";
    data: string;
  };
};

export type OpenAIImage = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

export type InstructorClient = IC<OpenAI> | IC<Anthropic>;

export interface ParsedTeiXmlDocument {
  title: string | null;
  doi: string | null;
  abstract: string | null;
  introduction: string | null;
  methods: string | null;
  results: string | null;
  discussion: string | null;
  conclusion: string | null;
  futureWork: string | null;
  appendix: string | null;
  citations: string | null;
  authors: string[];
  datePublished: string | null;
  publisher: string | null;
  error?: string;
}
