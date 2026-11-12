CXX ?= g++
CXXFLAGS ?= -O3 -std=c++17 -DNDEBUG -Wall -Wextra -Wpedantic
all: kunsolve
kunsolve: solver.cpp
	$(CXX) $(CXXFLAGS) -o $@ $<
clean:
	rm -f kunsolve
