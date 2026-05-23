---
name: skill-032
description: Perform sentiment analysis on customer reviews using NLP techniques to gain insights into product performance and customer satisfaction.
---

# Text Sentiment Analysis

Analyze customer reviews and extract sentiment scores to understand customer opinions and trends over time.

## Problem

Given a dataset of customer reviews, the goal is to evaluate the sentiment (positive, negative, neutral) expressed in each review. This provides valuable insights into customer satisfaction and product performance.

## Methodology

1. **Text Preprocessing**: Clean and prepare the text data by removing stop words, punctuation, and applying lemmatization.
2. **Sentiment Scoring**: Use pre-trained sentiment analysis models or libraries to score the sentiment of each review.
3. **Aggregation**: Summarize sentiment scores by product category to identify trends and areas for improvement.

## Output

A DataFrame with added columns:
- `review`: Original customer review
- `sentiment_score`: Float sentiment score (e.g., from -1 to 1)
- `sentiment_label`: Categorical sentiment label (positive, negative, neutral)

## Installation

```bash
pip install pandas numpy nltk transformers
python -c "import nltk; nltk.download('stopwords')"
```

## 3-Step Pipeline

### Step 1: Load and Preprocess Reviews (`step1_load_and_preprocess.py`)
- **Input**: CSV file of customer reviews with a `review` column.
- **Process**: Normalize text, tokenize words, remove stop words, and lemmatize.
- **Output**: Cleaned DataFrame with `review` column ready for analysis.

### Step 2: Analyze Sentiment (`step2_sentiment_analysis.py`)
- **Input**: Cleaned DataFrame from Step 1.
- **Process**: Apply sentiment analysis model to generate scores and labels for each review.
- **Output**: DataFrame with added `sentiment_score` and `sentiment_label` columns.

### Step 3: Summarize Results (`step3_aggregate_results.py`)
- **Input**: DataFrame from Step 2.
- **Process**: Group by product category and compute average sentiment scores.
- **Output**: Summary DataFrame of average sentiment scores by category.

```python
# Example of sentiment analysis using Hugging Face Transformers
from transformers import pipeline

# Load sentiment analysis pipeline
sentiment_pipeline = pipeline('sentiment-analysis')

# Example review
review = "This product is amazing!"
result = sentiment_pipeline(review)
print(result)
```

This skill provides a comprehensive approach to extracting sentiment from customer reviews, which can help businesses improve their products and services.