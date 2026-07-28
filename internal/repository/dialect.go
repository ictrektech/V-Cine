package repository

import (
	"gorm.io/gorm"
)

// dateFormatExpr returns a cross-driver SQL expression for date formatting.
// SQLite: strftime('%Y-%m-%d', col)  PostgreSQL: TO_CHAR(col, 'YYYY-MM-DD')
func dateFormatExpr(db *gorm.DB, format, column string) string {
	if db.Dialector.Name() == "postgres" {
		switch format {
		case "%Y-%m-%d":
			return "TO_CHAR(" + column + ", 'YYYY-MM-DD')"
		case "%Y-%m":
			return "TO_CHAR(" + column + ", 'YYYY-MM')"
		case "%H":
			return "EXTRACT(HOUR FROM " + column + ")::INTEGER"
		}
	}
	switch format {
	case "%H":
		return "CAST(strftime('" + format + "', " + column + ") AS INTEGER)"
	}
	return "strftime('" + format + "', " + column + ")"
}
