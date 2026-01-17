/* mpdb.h: C include file describing common elements used by both
 * MpExport and MpImport.
 *
 * Written in plain vanilla ANSI standard C; should compile pretty easily
 * with any regular C compiler.  Released to the public domain.
 *
 * Version 1.0, 28 Sep 1997, Rick Huebner
 */

/* Uncomment only one of the following definitions, depending
 * on the kind of machine you're compiling this program for.
 * Define BIG_ENDIAN if using a system which stores integers
 * starting with the most significant byte (Motorola, etc.), or
 * define LITTLE_ENDIAN if using a system which stores integers
 * starting with the least significant byte (Intel, etc.)
 */
/* #define BIG_ENDIAN */
#define LITTLE_ENDIAN

#ifdef LITTLE_ENDIAN
   #ifdef BIG_ENDIAN
      ERROR: Select only one "endian" definition
   #else
      void SwapWord(void *p);
      void SwapDWord(void *p);
   #endif
#else
   #ifndef BIG_ENDIAN
      ERROR: You must select an "endian" definition
   #else
      #define SwapWord(NoOp)
      #define SwapDWord(NoOp)
   #endif
#endif

/* Byte offset of a member variable in a structure; just in
 * case it's not defined in stddef.h like it should be
 */
#ifndef offsetof
   #define offsetof(s,m) (size_t)( (char *)&(((s *)0)->m) - (char *)0 )
#endif

#ifndef TRUE
   #define TRUE  1
   #define FALSE 0
#endif

/* Shared constants */
#define MathPadCreator   "MthP"
#define MathPadType      "Data"
#define MathPadVersion   1
#define CategoryLine     "Category = \"%s\"; Secret = %d\n"
#define CatTestLength    12
#define PlacesLine       "Places = %d; StripZeros = %d\n"
#define PlacesTestLength 9
#define SeparatorLine    "~~~~~~~~~~~~~~~~~~~~~~~~~~~\n"
#define SepTestLength    27
#define PilotEOL         0x0A

/* Basic data types used by MathPad and the system structs */
typedef char Char;
typedef unsigned char Byte;
typedef Byte Boolean;
typedef unsigned short int Word;
typedef unsigned long int DWord;
typedef DWord LocalID;



/* The following declarations are excerpted from the PalmPilot system
 * include files DataMgr.h, DataPrv.h, and Category.h to allow compilation
 * of this program without requiring the full set of PalmPilot headers.
 *
 * NOTE: When a PalmPilot database is backed up to the PC's hard drive,
 * the LocalID entries in the structs below are used to store the file
 * offsets where each memory chunk was written.  When the database is
 * re-installed on the PalmPilot, HotSync will change the LocalIDs to
 * show where each memory chunk is stored in the PalmPilot's memory.
 */
#define dmDBNameLength        32
#define dmCategoryLength      16
#define dmRecNumCategories    16
#define dmRecAttrCategoryMask 0x0F
#define dmRecAttrSecret       0x10
#define dmUnfiledCategory     0

typedef struct {
   LocalID localChunkID;
   Byte    attributes;
   Byte    uniqueID[3];
} RecordEntryType, *RecordEntryPtr;

typedef struct {
   LocalID nextRecordListID;
   Word    numRecords;
   Word    firstEntry;
} RecordListType, *RecordListPtr;

typedef struct {
   Byte    name[dmDBNameLength];
   Word    attributes;
   Word    version;
   DWord   creationDate;
   DWord   modificationDate;
   DWord   lastBackupDate;
   DWord   modificationNumber;
   LocalID appInfoID;
   LocalID sortInfoID;
   DWord   type;
   DWord   creator;
   DWord   uniqueIDSeed;
   RecordListType recordList;
} DatabaseHdrType, *DatabaseHdrPtr;

typedef struct {
   Word renamedCategories;
   Char categoryLabels[dmRecNumCategories][dmCategoryLength];
   Byte categoryUniqIDs[dmRecNumCategories];
   Byte lastUniqID;
} AppInfoType, *AppInfoPtr;



/* MathPad structures */
typedef struct {
   AppInfoType appinfo;
   Byte MathPadData[34];
} MathPadAppInfoType;

typedef struct {
   Byte places;
   Boolean stripzeros;
   char text[1];
} MathPadItemType;
