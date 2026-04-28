from flask import Flask, send_from_directory
import os
from flask_cors import CORS
import logging

from config import get_config
from api.routes import create_api
from loki_logger import configure_app_logging
from models.database import initialize_database

def create_app(config_name: str = None) -> Flask:
    """Application factory function"""
    
    # Create Flask app
    app = Flask(__name__)
    
    # Load configuration
    config = get_config(config_name)
    app.config.from_object(config)
    
    # Setup CORS
    CORS(app, resources={
        r"/api/*": {
            "origins": "*",
            "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"]
        },
        r"/docs/*": {
            "origins": "*",
            "methods": ["GET"],
            "allow_headers": ["Content-Type"]
        }
    })
    
    # Setup logging
    setup_logging(app, config)
    # Initialize database tables
    initialize_database()
    
    api = create_api()
    # Initialize Flask-RESTX API
    api.init_app(app)
    
    # Root route — serve the dashboard UI
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')

    @app.route('/')
    def index():
        return send_from_directory(static_dir, 'index.html')

    @app.route('/static/<path:filename>')
    def static_files(filename):
        return send_from_directory(static_dir, filename)

    return app


def setup_logging(app: Flask, config):
    """Setup application logging"""
    
    # Configure basic logging
    logging.basicConfig(
        level=getattr(logging, config.LOG_LEVEL),
        format=config.LOG_FORMAT
    )
    
    # Setup Loki logging if enabled - ONLY ONCE
    if config.LOKI_ENABLED and not hasattr(app, '_loki_configured'):
        try:
            configure_app_logging(app)
            app._loki_configured = True  # Mark as configured
            app.logger.info("Loki logging enabled")
        except Exception as e:
            app.logger.warning(f"Failed to setup Loki logging: {e}")


# Create app instance
app = create_app()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '0.0.0.0')
    debug = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'
    
    app.run(host=host, port=port, debug=debug)
