package repository

// dateFormatExpr returns a PostgreSQL date formatting expression.
func dateFormatExpr(format, column string) string {
	switch format {
	case "%Y-%m-%d":
		return "TO_CHAR(" + column + ", 'YYYY-MM-DD')"
	case "%Y-%m":
		return "TO_CHAR(" + column + ", 'YYYY-MM')"
	case "%H":
		return "EXTRACT(HOUR FROM " + column + ")::INTEGER"
	default:
		return "TO_CHAR(" + column + ", 'YYYY-MM-DD')"
	}
}
